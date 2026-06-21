import { useState, useEffect, useRef } from 'react'
import { io } from 'socket.io-client'
import { Send, Shield, Zap, Infinity as InfinityIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import JSZip from 'jszip'

import HomeView from './components/HomeView'
import WaitingRoom from './components/WaitingRoom'
import TransferSession from './components/TransferSession'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001'
const socket = io(SOCKET_URL, { autoConnect: false })

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:openrelay.metered.ca:80' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ]
}

const CHUNK_SIZE = 64 * 1024;
const BLOCK_SIZE = 2 * 1024 * 1024;

function App() {
  const [appState, setAppState] = useState('idle') 
  const [roomCode, setRoomCode] = useState('')
  const [joinCodeInput, setJoinCodeInput] = useState('')
  const [error, setError] = useState('')
  const [isSender, setIsSender] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState('disconnected') 

  const [selectedFile, setSelectedFile] = useState(null)
  const [transferProgress, setTransferProgress] = useState(0)
  const [transferSpeed, setTransferSpeed] = useState(0)
  const [transferETA, setTransferETA] = useState(0)
  const [isZipping, setIsZipping] = useState(false)
  const [receivingMeta, setReceivingMeta] = useState(null)
  
  const [messages, setMessages] = useState([])
  const [isPaused, setIsPaused] = useState(false)

  const peerConnection = useRef(null)
  const dataChannel = useRef(null)
  const pendingCandidates = useRef([])
  const roomCodeRef = useRef('')
  
  const receivedChunks = useRef([])
  const receivedSize = useRef(0)
  const metaRef = useRef(null) 
  const lastProgressUpdate = useRef(0)
  const speedUpdateInterval = useRef(Date.now())
  const bytesSinceLastSpeedUpdate = useRef(0)
  const isPausedRef = useRef(false)

  // Auto-join from URL
  useEffect(() => {
    socket.connect()

    const pathCode = window.location.pathname.replace('/', '').toUpperCase()
    if (pathCode.length === 6) {
      setJoinCodeInput(pathCode)
      // Small timeout to ensure socket is connected before emitting
      setTimeout(() => {
        socket.emit('join-room', pathCode)
      }, 500)
    }

    socket.on('room-created', (code) => {
      setRoomCode(code)
      roomCodeRef.current = code
      setIsSender(true)
      setAppState('waiting')
      window.history.pushState({}, '', `/${code}`)
    })

    socket.on('room-joined', (code) => {
      setRoomCode(code)
      roomCodeRef.current = code
      setIsSender(false)
      setAppState('in-room')
      setError('')
      window.history.pushState({}, '', `/${code}`)
    })

    socket.on('peer-joined', async () => {
      setAppState('in-room')
      setError('')
      await initiateConnection()
    })

    socket.on('offer', async (offer) => {
      await handleReceiveOffer(offer)
    })

    socket.on('answer', async (answer) => {
      if (peerConnection.current) {
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(answer))
        
        // Process any ICE candidates that arrived before the answer
        while (pendingCandidates.current.length > 0) {
          try {
            await peerConnection.current.addIceCandidate(pendingCandidates.current.shift())
          } catch (e) {
            console.error('Error adding pending ice candidate', e)
          }
        }
      }
    })

    socket.on('ice-candidate', async (candidate) => {
      const rtcCandidate = new RTCIceCandidate(candidate)
      if (peerConnection.current && peerConnection.current.remoteDescription) {
        try {
          await peerConnection.current.addIceCandidate(rtcCandidate)
        } catch (e) {
          console.error('Error adding received ice candidate', e)
        }
      } else {
        // Queue candidates until remote description is set
        pendingCandidates.current.push(rtcCandidate)
      }
    })

    socket.on('room-error', (msg) => {
      setError(msg)
      setAppState('idle')
      window.history.pushState({}, '', `/`)
    })

    return () => {
      socket.off('room-created')
      socket.off('room-joined')
      socket.off('peer-joined')
      socket.off('offer')
      socket.off('answer')
      socket.off('ice-candidate')
      socket.off('room-error')
    }
  }, [])

  const setupPeerConnection = () => {
    const pc = new RTCPeerConnection(ICE_SERVERS)
    
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', { candidate: event.candidate, roomCode: roomCodeRef.current })
      }
    }

    pc.onconnectionstatechange = () => {
      setConnectionStatus(pc.connectionState)
    }

    peerConnection.current = pc
    return pc
  }

  const initiateConnection = async () => {
    const pc = setupPeerConnection()
    
    const dc = pc.createDataChannel('fileTransfer')
    setupDataChannel(dc)
    
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    socket.emit('offer', { offer, roomCode: roomCodeRef.current })
  }

  const handleReceiveOffer = async (offer) => {
    const pc = setupPeerConnection()
    
    pc.ondatachannel = (event) => {
      setupDataChannel(event.channel)
    }

    await pc.setRemoteDescription(new RTCSessionDescription(offer))
    
    // Process any ICE candidates that arrived before the offer was fully processed
    while (pendingCandidates.current.length > 0) {
      try {
        await pc.addIceCandidate(pendingCandidates.current.shift())
      } catch (e) {
        console.error('Error adding pending ice candidate', e)
      }
    }

    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    socket.emit('answer', { answer, roomCode: roomCodeRef.current })
  }

  const setupDataChannel = (dc) => {
    dc.binaryType = 'arraybuffer'; 
    dc.bufferedAmountLowThreshold = 256 * 1024;

    dc.onopen = () => {
      setConnectionStatus('connected')
    }
    
    dc.onmessage = (event) => {
      if (typeof event.data === 'string') {
        const meta = JSON.parse(event.data)
        if (meta.type === 'metadata') {
          metaRef.current = meta
          setReceivingMeta(meta)
          receivedChunks.current = []
          receivedSize.current = 0
          setTransferProgress(0)
          setTransferSpeed(0)
          setTransferETA(0)
          lastProgressUpdate.current = Date.now()
          speedUpdateInterval.current = Date.now()
          bytesSinceLastSpeedUpdate.current = 0
        } else if (meta.type === 'chat') {
          setMessages(prev => [...prev, { ...meta, sender: 'peer' }])
        } else if (meta.type === 'control') {
          if (meta.action === 'pause') {
            setIsPaused(true)
            isPausedRef.current = true
          } else if (meta.action === 'resume') {
            setIsPaused(false)
            isPausedRef.current = false
          }
        }
      } else {
        receivedChunks.current.push(event.data)
        receivedSize.current += event.data.byteLength
        bytesSinceLastSpeedUpdate.current += event.data.byteLength
        
        if (metaRef.current) {
          const progress = (receivedSize.current / metaRef.current.size) * 100
          
          const now = Date.now()
          if (now - speedUpdateInterval.current >= 1000) {
            const timeDiff = (now - speedUpdateInterval.current) / 1000
            const speedBytesPerSec = bytesSinceLastSpeedUpdate.current / timeDiff
            setTransferSpeed(speedBytesPerSec / (1024 * 1024))
            const remainingBytes = metaRef.current.size - receivedSize.current
            setTransferETA(speedBytesPerSec > 0 ? remainingBytes / speedBytesPerSec : 0)
            
            speedUpdateInterval.current = now
            bytesSinceLastSpeedUpdate.current = 0
          }

          if (now - lastProgressUpdate.current > 50 || receivedSize.current === metaRef.current.size) {
            setTransferProgress(progress)
            lastProgressUpdate.current = now
          }
          
          if (receivedSize.current === metaRef.current.size) {
            completeDownload(metaRef.current)
          }
        }
      }
    }
    
    dataChannel.current = dc
  }

  const completeDownload = (meta) => {
    const blob = new Blob(receivedChunks.current, { type: meta.mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = meta.name
    a.click()
    URL.revokeObjectURL(url)
    
    setTimeout(() => {
      receivedChunks.current = []
    }, 1000)
  }

  const sendFile = async () => {
    if (!selectedFile || !dataChannel.current) return;
    
    const dc = dataChannel.current;
    lastProgressUpdate.current = Date.now();
    speedUpdateInterval.current = Date.now();
    bytesSinceLastSpeedUpdate.current = 0;
    
    const meta = {
      type: 'metadata',
      name: selectedFile.name,
      size: selectedFile.size,
      mime: selectedFile.type || 'application/octet-stream'
    }
    dc.send(JSON.stringify(meta))
    
    let offset = 0;
    
    const readBlock = (o) => {
      return new Promise((resolve, reject) => {
        const slice = selectedFile.slice(o, o + BLOCK_SIZE);
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsArrayBuffer(slice);
      });
    }

    while (offset < selectedFile.size) {
      while (isPausedRef.current) {
        await new Promise(r => setTimeout(r, 200))
      }
      
      const blockBuffer = await readBlock(offset);
      let blockOffset = 0;

      while (blockOffset < blockBuffer.byteLength) {
        if (dc.bufferedAmount > 1024 * 1024) { 
          await new Promise(resolve => {
            dc.onbufferedamountlow = () => {
              dc.onbufferedamountlow = null;
              resolve();
            }
          });
        }

        const end = Math.min(blockOffset + CHUNK_SIZE, blockBuffer.byteLength);
        const chunk = blockBuffer.slice(blockOffset, end);
        dc.send(chunk);
        blockOffset += chunk.byteLength;
      }
      
      offset += blockBuffer.byteLength;
      bytesSinceLastSpeedUpdate.current += blockBuffer.byteLength;
      
      const now = Date.now();
      if (now - speedUpdateInterval.current >= 1000) {
        const timeDiff = (now - speedUpdateInterval.current) / 1000;
        const speedBytesPerSec = bytesSinceLastSpeedUpdate.current / timeDiff;
        setTransferSpeed(speedBytesPerSec / (1024 * 1024));
        const remainingBytes = selectedFile.size - offset;
        setTransferETA(speedBytesPerSec > 0 ? remainingBytes / speedBytesPerSec : 0);
        
        speedUpdateInterval.current = now;
        bytesSinceLastSpeedUpdate.current = 0;
      }

      if (now - lastProgressUpdate.current > 50) {
        setTransferProgress((offset / selectedFile.size) * 100);
        lastProgressUpdate.current = now;
      }
    }
    
    setTransferProgress(100);
  }

  const handleCreateRoom = () => socket.emit('create-room')
  
  const handleJoinRoom = (e) => {
    e.preventDefault()
    if (joinCodeInput.trim().length > 0) {
      socket.emit('join-room', joinCodeInput.trim().toUpperCase())
    }
  }

  const processFiles = async (fileList) => {
    if (!fileList || fileList.length === 0) return;
    
    if (fileList.length === 1) {
      setSelectedFile(fileList[0])
    } else {
      setIsZipping(true)
      const zip = new JSZip()
      Array.from(fileList).forEach(f => {
        zip.file(f.name, f)
      })
      const blob = await zip.generateAsync({ type: 'blob' })
      const zipFile = new File([blob], 'MiniShare_Transfer.zip', { type: 'application/zip' })
      setSelectedFile(zipFile)
      setIsZipping(false)
    }
    setTransferProgress(0)
    setTransferSpeed(0)
    setTransferETA(0)
  }

  const handleFileChange = (e) => {
    processFiles(e.target.files)
  }

  const getAllFileEntries = async (dataTransferItemList) => {
    let fileEntries = [];
    let queue = [];
    for (let i = 0; i < dataTransferItemList.length; i++) {
      const item = dataTransferItemList[i];
      if (item.webkitGetAsEntry) {
        const entry = item.webkitGetAsEntry();
        if (entry) queue.push(entry);
      }
    }
    
    const readDirectory = (dirEntry) => {
      return new Promise((resolve) => {
        const reader = dirEntry.createReader();
        reader.readEntries((entries) => resolve(entries));
      });
    };

    while (queue.length > 0) {
      let entry = queue.shift();
      if (entry.isFile) {
        fileEntries.push(entry);
      } else if (entry.isDirectory) {
        let entries = await readDirectory(entry);
        queue.push(...entries);
      }
    }
    return fileEntries;
  }

  const handleFileDrop = async (e) => {
    e.preventDefault()
    if (e.dataTransfer.items) {
      setIsZipping(true)
      const fileEntries = await getAllFileEntries(e.dataTransfer.items)
      if (fileEntries.length === 0) {
        setIsZipping(false)
        return
      }
      if (fileEntries.length === 1 && fileEntries[0].fullPath.indexOf('/') === fileEntries[0].fullPath.lastIndexOf('/')) {
        fileEntries[0].file((f) => {
          setSelectedFile(f)
          setTransferProgress(0)
          setTransferSpeed(0)
          setTransferETA(0)
          setIsZipping(false)
        })
      } else {
        const zip = new JSZip()
        const filePromises = fileEntries.map(entry => {
          return new Promise(resolve => {
            entry.file(f => {
              const path = entry.fullPath.startsWith('/') ? entry.fullPath.slice(1) : entry.fullPath
              zip.file(path, f)
              resolve()
            })
          })
        })
        await Promise.all(filePromises)
        const blob = await zip.generateAsync({ type: 'blob' })
        const zipFile = new File([blob], 'MiniShare_Folder.zip', { type: 'application/zip' })
        setSelectedFile(zipFile)
        setTransferProgress(0)
        setTransferSpeed(0)
        setTransferETA(0)
        setIsZipping(false)
      }
    } else if (e.dataTransfer.files) {
      processFiles(e.dataTransfer.files)
    }
  }

  const sendMessage = (text) => {
    if (dataChannel.current && dataChannel.current.readyState === 'open') {
      const msg = { type: 'chat', text, sender: 'me', timestamp: Date.now() }
      dataChannel.current.send(JSON.stringify(msg))
      setMessages(prev => [...prev, msg])
    }
  }

  const togglePause = () => {
    const newState = !isPaused;
    setIsPaused(newState);
    isPausedRef.current = newState;
    if (dataChannel.current && dataChannel.current.readyState === 'open') {
      dataChannel.current.send(JSON.stringify({ type: 'control', action: newState ? 'pause' : 'resume' }))
    }
  }

  const handleGoHome = () => {
    setAppState('idle')
    setRoomCode('')
    setJoinCodeInput('')
    window.history.pushState({}, '', `/`)
    if (peerConnection.current) {
      peerConnection.current.close()
    }
    setConnectionStatus('disconnected')
  }

  return (
    <div className="min-h-screen flex flex-col font-sans relative overflow-x-hidden bg-slate-50">
      {/* Animated Background Blobs */}
      <div className="absolute inset-0 overflow-hidden -z-10 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40rem] h-[40rem] bg-purple-300 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob"></div>
        <div className="absolute top-[10%] right-[-10%] w-[40rem] h-[40rem] bg-brand-300 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-2000"></div>
        <div className="absolute bottom-[-10%] left-[20%] w-[40rem] h-[40rem] bg-blue-300 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-4000"></div>
      </div>

      <div className="flex-1 flex flex-col p-4 sm:p-8 z-10">
        {/* Navbar / Header */}
        <div className="w-full max-w-6xl mx-auto flex items-center justify-between mb-12 sm:mb-20">
          <button onClick={handleGoHome} className="flex items-center gap-3 group focus:outline-none">
            <div className="w-12 h-12 rounded-2xl bg-brand-600 flex items-center justify-center text-white shadow-lg shadow-brand-500/30 group-hover:scale-105 transition-transform">
              <Send className="w-6 h-6" />
            </div>
            <span className="text-2xl font-bold text-slate-800 tracking-tight">MiniShare</span>
          </button>
        </div>

        {/* Main Grid Layout */}
        <div className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-24 items-center mb-12 flex-1">
          
          {/* Left Column: Content */}
          <div className={`space-y-8 ${appState !== 'idle' && 'hidden lg:block lg:opacity-50 transition-opacity'}`}>
            <h1 className="text-5xl sm:text-6xl font-extrabold text-slate-900 leading-[1.1] tracking-tight">
              Share files <br/><span className="text-brand-600">securely</span> & directly.
            </h1>
            <p className="text-lg sm:text-xl text-slate-600 leading-relaxed max-w-lg">
              Send files of any size directly from your device to another. Your files are never stored on any server. It's fast, private, and peer-to-peer.
            </p>

            <div className="space-y-6 pt-4">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 border border-blue-100 shadow-sm">
                  <Shield className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-800">End-to-End Encrypted</h3>
                  <p className="text-slate-600">Files are transferred directly between devices using WebRTC, secured with DTLS encryption.</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 border border-amber-100 shadow-sm">
                  <Zap className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-800">Lightning Fast</h3>
                  <p className="text-slate-600">By cutting out the middleman server, transfers happen at the maximum speed your network allows.</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0 border border-purple-100 shadow-sm">
                  <InfinityIcon className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-800">No File Size Limits</h3>
                  <p className="text-slate-600">Since we don't store your files, there are no artificial limits. Share gigabytes of data effortlessly.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: The App Card */}
          <motion.div 
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="w-full max-w-md mx-auto lg:ml-auto glass rounded-[2rem] p-8 sm:p-10 relative overflow-hidden shadow-[0_20px_60px_-15px_rgba(0,0,0,0.1)]"
          >
            {/* Content Area */}
            <AnimatePresence mode="wait">
              {appState === 'idle' && (
                <HomeView 
                  handleCreateRoom={handleCreateRoom}
                  handleJoinRoom={handleJoinRoom}
                  joinCodeInput={joinCodeInput}
                  setJoinCodeInput={setJoinCodeInput}
                  error={error}
                />
              )}

              {appState === 'waiting' && (
                <WaitingRoom roomCode={roomCode} />
              )}

              {appState === 'in-room' && (
                <TransferSession 
                  connectionStatus={connectionStatus}
                  isSender={isSender}
                  selectedFile={selectedFile}
                  handleFileDrop={handleFileDrop}
                  handleFileChange={handleFileChange}
                  transferProgress={transferProgress}
                  transferSpeed={transferSpeed}
                  transferETA={transferETA}
                  isZipping={isZipping}
                  sendFile={sendFile}
                  receivingMeta={receivingMeta}
                  messages={messages}
                  sendMessage={sendMessage}
                  isPaused={isPaused}
                  togglePause={togglePause}
                />
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      </div>
      
      {/* Expanded Content Sections (Visible only on idle) */}
      {appState === 'idle' && (
        <div className="w-full bg-white z-10">
          <div className="w-full max-w-6xl mx-auto px-4 sm:px-8 py-24">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 text-center mb-16 tracking-tight">How it works</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
              <div className="text-center space-y-4">
                <div className="w-16 h-16 bg-brand-50 text-brand-600 rounded-full flex items-center justify-center mx-auto text-2xl font-bold border border-brand-100 shadow-sm">1</div>
                <h3 className="text-xl font-semibold text-slate-800">Select Files</h3>
                <p className="text-slate-600">Choose any files you want to share. A secure room and a unique QR code are generated instantly.</p>
              </div>
              <div className="text-center space-y-4">
                <div className="w-16 h-16 bg-brand-50 text-brand-600 rounded-full flex items-center justify-center mx-auto text-2xl font-bold border border-brand-100 shadow-sm">2</div>
                <h3 className="text-xl font-semibold text-slate-800">Share Link</h3>
                <p className="text-slate-600">Send the generated link or show the QR code to the receiver. They just need to open it in their browser.</p>
              </div>
              <div className="text-center space-y-4">
                <div className="w-16 h-16 bg-brand-50 text-brand-600 rounded-full flex items-center justify-center mx-auto text-2xl font-bold border border-brand-100 shadow-sm">3</div>
                <h3 className="text-xl font-semibold text-slate-800">Transfer Direct</h3>
                <p className="text-slate-600">The devices connect peer-to-peer. Keep your tab open until the fast, secure transfer is complete.</p>
              </div>
            </div>
          </div>

          <div className="w-full max-w-4xl mx-auto px-4 sm:px-8 py-24 border-t border-slate-100">
            <h2 className="text-3xl font-bold text-slate-900 text-center mb-12 tracking-tight">Frequently Asked Questions</h2>
            
            <div className="space-y-6">
              <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200">
                <h3 className="text-lg font-semibold text-slate-800 mb-2">Are my files stored on your servers?</h3>
                <p className="text-slate-600">Never. MiniShare uses WebRTC to establish a direct connection between you and the receiver. Your data goes straight from your device to theirs without stopping anywhere in between.</p>
              </div>
              <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200">
                <h3 className="text-lg font-semibold text-slate-800 mb-2">Is there really no file size limit?</h3>
                <p className="text-slate-600">Yes! Because we don't pay for server storage or bandwidth to hold your files, we don't have to impose limits. You can send files of any size, limited only by your own internet connection and device storage.</p>
              </div>
              <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200">
                <h3 className="text-lg font-semibold text-slate-800 mb-2">Is it secure?</h3>
                <p className="text-slate-600">Yes. The WebRTC connection is End-to-End Encrypted by default using Datagram Transport Layer Security (DTLS). Nobody, not even us, can intercept or read the files you send.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer info */}
      <div className="w-full bg-slate-900 text-slate-400 text-sm py-8 text-center z-10">
        &copy; {new Date().getFullYear()} MiniShare. Built with React and WebRTC.
      </div>
    </div>
  )
}

export default App
