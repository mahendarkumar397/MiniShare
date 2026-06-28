import { useState, useEffect, useRef } from 'react'
import { io } from 'socket.io-client'
import { Send, Shield, Zap, Infinity as InfinityIcon, Info, X } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { downloadZip } from 'client-zip'

import HomeView from './components/HomeView'
import WaitingRoom from './components/WaitingRoom'
import TransferSession from './components/TransferSession'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001'
const socket = io(SOCKET_URL, { autoConnect: false })

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
}

const CHUNK_SIZE = 64 * 1024;
const BLOCK_SIZE = 2 * 1024 * 1024;

function App() {
  const [appState, setAppState] = useState('idle') 
  const [roomCode, setRoomCode] = useState('')
  const [joinCodeInput, setJoinCodeInput] = useState('')
  const [error, setError] = useState('')
  const [showRules, setShowRules] = useState(false)
  
  // connectionStatus could be string or just count of connected peers. Let's keep it as string.
  const [connectionStatus, setConnectionStatus] = useState('disconnected') 
  const [peers, setPeers] = useState([]) // list of connected peer socket IDs

  const [selectedFile, setSelectedFile] = useState(null)
  const [transferProgress, setTransferProgress] = useState(0)
  const [transferSpeed, setTransferSpeed] = useState(0)
  const [transferETA, setTransferETA] = useState(0)
  const [isZipping, setIsZipping] = useState(false)
  const [receivingMeta, setReceivingMeta] = useState(null)
  const [isTransferAccepted, setIsTransferAccepted] = useState(false)
  
  const [messages, setMessages] = useState([])
  const [isPaused, setIsPaused] = useState(false)
  const [isWaitingForReceiver, setIsWaitingForReceiver] = useState(false)

  // WebRTC Mesh state
  const peerConnections = useRef({}) // { peerId: RTCPeerConnection }
  const dataChannels = useRef({}) // { peerId: RTCDataChannel }
  const pendingCandidates = useRef({}) // { peerId: [RTCIceCandidate] }
  const roomCodeRef = useRef('')
  
  // Transfer tracking per peer
  const receivedSize = useRef({}) // { peerId: number }
  const metaRef = useRef({}) // { peerId: metaObj }
  const fileStreamRef = useRef({}) // { peerId: FileSystemWritableFileStream }
  const peerReadyRef = useRef({}) // { peerId: boolean }
  const unackedBytesRef = useRef({}) // { peerId: number }
  const receiveBuffer = useRef({}) // { peerId: Array }
  const receiveBufferSize = useRef({}) // { peerId: number }
  const writeQueue = useRef({}) // { peerId: Promise }
  
  const lastProgressUpdate = useRef(0)
  const speedUpdateInterval = useRef(0)
  const bytesSinceLastSpeedUpdate = useRef(0)
  const isPausedRef = useRef(false)

  // Auto-join from URL
  useEffect(() => {
    socket.connect()

    let timeoutId;
    const pathCode = window.location.pathname.replace('/', '').toUpperCase()
    if (pathCode.length === 6) {
      timeoutId = setTimeout(() => {
        setJoinCodeInput(pathCode)
        socket.emit('join-room', pathCode)
      }, 500)
    }
    
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }, [])

  useEffect(() => {
    socket.on('room-created', (code) => {
      setRoomCode(code)
      roomCodeRef.current = code
      setAppState('waiting')
      window.history.pushState({}, '', `/${code}`)
    })

    socket.on('room-joined', (code) => {
      setRoomCode(code)
      roomCodeRef.current = code
      setAppState('in-room')
      setError('')
      window.history.pushState({}, '', `/${code}`)
    })

    socket.on('peer-joined', async (peerId) => {
      setAppState('in-room')
      setError('')
      setPeers(prev => {
        if (!prev.includes(peerId)) return [...prev, peerId];
        return prev;
      })
      await initiateConnection(peerId)
    })

    socket.on('offer', async ({ offer, from }) => {
      setPeers(prev => {
        if (!prev.includes(from)) return [...prev, from];
        return prev;
      })
      await handleReceiveOffer(offer, from)
    })

    socket.on('answer', async ({ answer, from }) => {
      const pc = peerConnections.current[from]
      if (pc) {
        if (pc.signalingState === 'stable') {
          return; // Already processed an answer
        }
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer))
        } catch (e) {
          console.error("Failed to set remote answer", e)
          return;
        }
        
        // Process any ICE candidates that arrived before the answer
        const queue = pendingCandidates.current[from] || []
        while (queue.length > 0) {
          try {
            await pc.addIceCandidate(queue.shift())
          } catch (e) {
            console.error('Error adding pending ice candidate', e)
          }
        }
      }
    })

    socket.on('ice-candidate', async ({ candidate, from }) => {
      const rtcCandidate = new RTCIceCandidate(candidate)
      const pc = peerConnections.current[from]
      if (pc && pc.remoteDescription) {
        try {
          await pc.addIceCandidate(rtcCandidate)
        } catch (e) {
          console.error('Error adding received ice candidate', e)
        }
      } else {
        if (!pendingCandidates.current[from]) pendingCandidates.current[from] = []
        pendingCandidates.current[from].push(rtcCandidate)
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

  // Update overall connection status based on active channels
  const checkConnectionStatus = () => {
    const activeChannels = Object.values(dataChannels.current).filter(dc => dc.readyState === 'open')
    if (activeChannels.length > 0) {
      setConnectionStatus('connected')
      setAppState('in-room')
    } else {
      setConnectionStatus('disconnected')
    }
  }

  function setupPeerConnection(peerId) {
    const pc = new RTCPeerConnection(ICE_SERVERS)
    
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', { candidate: event.candidate, to: peerId })
      }
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        delete peerConnections.current[peerId]
        delete dataChannels.current[peerId]
        setPeers(prev => prev.filter(p => p !== peerId))
        checkConnectionStatus()
      }
    }

    peerConnections.current[peerId] = pc
    return pc
  }

  async function initiateConnection(peerId) {
    const pc = setupPeerConnection(peerId)
    
    const dc = pc.createDataChannel('fileTransfer')
    setupDataChannel(dc, peerId)
    
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    socket.emit('offer', { offer, to: peerId })
  }

  async function handleReceiveOffer(offer, peerId) {
    const pc = setupPeerConnection(peerId)
    
    pc.ondatachannel = (event) => {
      setupDataChannel(event.channel, peerId)
    }

    await pc.setRemoteDescription(new RTCSessionDescription(offer))
    
    const queue = pendingCandidates.current[peerId] || []
    while (queue.length > 0) {
      try {
        await pc.addIceCandidate(queue.shift())
      } catch (e) {
        console.error('Error adding pending ice candidate', e)
      }
    }

    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    socket.emit('answer', { answer, to: peerId })
  }

  function setupDataChannel(dc, peerId) {
    dc.binaryType = 'arraybuffer'; 
    dc.bufferedAmountLowThreshold = 256 * 1024;

    const handleOpen = () => {
      dataChannels.current[peerId] = dc
      checkConnectionStatus()
    }

    if (dc.readyState === 'open') {
      handleOpen()
    } else {
      dc.onopen = handleOpen
    }

    dc.onclose = () => {
      delete dataChannels.current[peerId]
      checkConnectionStatus()
    }
    
    dc.onmessage = (event) => {
      if (typeof event.data === 'string') {
        const meta = JSON.parse(event.data)
        if (meta.type === 'metadata') {
          metaRef.current[peerId] = meta
          setReceivingMeta({ ...meta, peerId }) // Will reflect the most recent file sent to us
          setIsTransferAccepted(false)
          receivedSize.current[peerId] = 0
          setTransferProgress(0)
          setTransferSpeed(0)
          setTransferETA(0)
          lastProgressUpdate.current = Date.now()
          speedUpdateInterval.current = Date.now()
          bytesSinceLastSpeedUpdate.current = 0
        } else if (meta.type === 'chat') {
          setMessages(prev => [...prev, { ...meta, sender: 'peer', peerId }])
        } else if (meta.type === 'control') {
          if (meta.action === 'pause') {
            setIsPaused(true)
            isPausedRef.current = true
          } else if (meta.action === 'resume') {
            setIsPaused(false)
            isPausedRef.current = false
          } else if (meta.action === 'ready') {
            peerReadyRef.current[peerId] = true
          } else if (meta.action === 'ack') {
            if (!unackedBytesRef.current[peerId]) unackedBytesRef.current[peerId] = 0
            unackedBytesRef.current[peerId] -= meta.size
          } else if (meta.action === 'done') {
            const stream = fileStreamRef.current[peerId];
            if (stream) {
              const flushBuffer = async () => {
                if (receiveBuffer.current[peerId] && receiveBuffer.current[peerId].length > 0) {
                  const blob = new Blob(receiveBuffer.current[peerId]);
                  receiveBuffer.current[peerId] = [];
                  receiveBufferSize.current[peerId] = 0;
                  try {
                    await stream.write(blob);
                    if (dc.readyState === 'open') {
                      dc.send(JSON.stringify({ type: 'control', action: 'ack', size: blob.size }));
                    }
                  } catch (e) {
                    console.error("Final write failed", e);
                  }
                }
                await stream.close().catch(e => console.error("Failed to close stream", e));
              };
              flushBuffer();
              delete fileStreamRef.current[peerId];
            }
            setTransferProgress(100);
          }
        }
      } else {
        if (!receivedSize.current[peerId]) receivedSize.current[peerId] = 0

        receivedSize.current[peerId] += event.data.byteLength
        bytesSinceLastSpeedUpdate.current += event.data.byteLength

        const stream = fileStreamRef.current[peerId];
        if (stream) {
          if (!receiveBuffer.current[peerId]) {
            receiveBuffer.current[peerId] = [];
            receiveBufferSize.current[peerId] = 0;
          }
          receiveBuffer.current[peerId].push(event.data);
          receiveBufferSize.current[peerId] += event.data.byteLength;

          // 2MB flush threshold
          if (receiveBufferSize.current[peerId] >= 2 * 1024 * 1024) {
            const blob = new Blob(receiveBuffer.current[peerId]);
            receiveBuffer.current[peerId] = [];
            receiveBufferSize.current[peerId] = 0;
            
            writeQueue.current[peerId] = (writeQueue.current[peerId] || Promise.resolve())
              .then(() => stream.write(blob))
              .then(() => {
                if (dc.readyState === 'open') {
                   dc.send(JSON.stringify({ type: 'control', action: 'ack', size: blob.size }));
                }
              })
              .catch(err => console.error("Write failed", err));
          }
        }

        
        const fileMeta = metaRef.current[peerId]
        if (fileMeta) {
          const progress = (receivedSize.current[peerId] / fileMeta.size) * 100
          
          const now = Date.now()
          if (now - speedUpdateInterval.current >= 1000) {
            const timeDiff = (now - speedUpdateInterval.current) / 1000
            const speedBytesPerSec = bytesSinceLastSpeedUpdate.current / timeDiff
            setTransferSpeed(speedBytesPerSec / (1024 * 1024))
            const remainingBytes = fileMeta.size - receivedSize.current[peerId]
            setTransferETA(speedBytesPerSec > 0 ? remainingBytes / speedBytesPerSec : 0)
            
            speedUpdateInterval.current = now
            bytesSinceLastSpeedUpdate.current = 0
          }

          if (now - lastProgressUpdate.current > 50 || receivedSize.current[peerId] >= fileMeta.size) {
            let pct = progress;
            if (fileMeta.isMultiple) pct = Math.min(99, pct);
            setTransferProgress(pct)
            lastProgressUpdate.current = now
          }
          
          if (!fileMeta.isMultiple && receivedSize.current[peerId] >= fileMeta.size) {
            if (stream) {
              stream.close().catch(e => console.error("Failed to close stream", e));
              delete fileStreamRef.current[peerId];
            }
            setTransferProgress(100);
          }
        }
      }
    }
  }

  const [isPrompting, setIsPrompting] = useState(false);

  const acceptTransfer = async (peerId) => {
    if (isPrompting) return;
    setIsPrompting(true);
    try {
      const meta = metaRef.current[peerId];
      if (!meta) {
        setIsPrompting(false);
        return;
      }
      
      const handle = await window.showSaveFilePicker({
        suggestedName: meta.name,
      });
      const writable = await handle.createWritable();
      fileStreamRef.current[peerId] = writable;
      
      setIsTransferAccepted(true);
      
      const dc = dataChannels.current[peerId];
      if (dc && dc.readyState === 'open') {
        dc.send(JSON.stringify({ type: 'control', action: 'ready' }));
      }
    } catch (e) {
      console.error("Transfer rejected or failed", e);
      // If user cancels, don't destroy the transfer UI! Just let them click Accept again.
    } finally {
      setIsPrompting(false);
    }
  }

  const sendFile = async () => {
    if (isWaitingForReceiver) return;
    setIsWaitingForReceiver(true);

    const activeChannels = Object.values(dataChannels.current).filter(dc => dc.readyState === 'open');
    if (!selectedFile || activeChannels.length === 0) {
      setIsWaitingForReceiver(false);
      return;
    }
    
    lastProgressUpdate.current = Date.now();
    speedUpdateInterval.current = Date.now();
    bytesSinceLastSpeedUpdate.current = 0;
    
    const meta = {
      type: 'metadata',
      name: selectedFile.name,
      size: selectedFile.size,
      mime: selectedFile.type || 'application/octet-stream',
      isMultiple: !!selectedFile.isMultiple
    }
    const metaStr = JSON.stringify(meta)
    
    activeChannels.forEach(dc => {
      const pId = Object.keys(dataChannels.current).find(id => dataChannels.current[id] === dc);
      peerReadyRef.current[pId] = false;
      unackedBytesRef.current[pId] = 0;
      dc.send(metaStr);
    });
    
    while (!Object.values(peerReadyRef.current).some(r => r) && !isPausedRef.current) {
       await new Promise(r => setTimeout(r, 200))
    }
    
    setIsWaitingForReceiver(false);
    
    let offset = 0;
    
    let stream;
    if (selectedFile.isMultiple) {
      stream = downloadZip(selectedFile.files).body;
    } else {
      stream = selectedFile.stream();
    }
    
    const reader = stream.getReader();

    while (true) {
      while (isPausedRef.current) {
        await new Promise(r => setTimeout(r, 200))
      }
      
      const readyChannels = activeChannels.filter(dc => {
        const pId = Object.keys(dataChannels.current).find(id => dataChannels.current[id] === dc);
        return peerReadyRef.current[pId];
      });

      if (readyChannels.length === 0) {
        await new Promise(r => setTimeout(r, 200));
        continue;
      }
      
      const { done, value } = await reader.read();
      if (done) break;

      let blockOffset = 0;

      while (blockOffset < value.byteLength) {
        const currentReadyChannels = activeChannels.filter(dc => {
          const pId = Object.keys(dataChannels.current).find(id => dataChannels.current[id] === dc);
          return peerReadyRef.current[pId];
        });

        if (currentReadyChannels.length === 0) {
          await new Promise(r => setTimeout(r, 200));
          continue;
        }

        const isCongested = currentReadyChannels.some(dc => {
          const pId = Object.keys(dataChannels.current).find(id => dataChannels.current[id] === dc);
          const unacked = unackedBytesRef.current[pId] || 0;
          return unacked > 32 * 1024 * 1024; // 32MB backpressure limit
        });
        
        const maxBuffered = Math.max(...currentReadyChannels.map(dc => dc.bufferedAmount));
        
        if (isCongested || maxBuffered > 8 * 1024 * 1024) { 
          await new Promise(r => setTimeout(r, 5))
          continue;
        }

        const end = Math.min(blockOffset + CHUNK_SIZE, value.byteLength);
        const chunk = value.slice(blockOffset, end);
        
        currentReadyChannels.forEach(dc => {
          if (dc.readyState === 'open') {
             const pId = Object.keys(dataChannels.current).find(id => dataChannels.current[id] === dc);
             if (!unackedBytesRef.current[pId]) unackedBytesRef.current[pId] = 0;
             try {
               dc.send(chunk);
               unackedBytesRef.current[pId] += chunk.byteLength;
             } catch (e) {
               console.error("dc.send crashed for peer", pId, e);
               dc.close(); // Drop this peer so it doesn't break the transfer for others
             }
          }
        });
        
        blockOffset += chunk.byteLength;
      }
      
      offset += value.byteLength;
      bytesSinceLastSpeedUpdate.current += value.byteLength;
      
      const now = Date.now();
      if (now - speedUpdateInterval.current >= 1000) {
        const timeDiff = (now - speedUpdateInterval.current) / 1000;
        const speedBytesPerSec = bytesSinceLastSpeedUpdate.current / timeDiff;
        setTransferSpeed(speedBytesPerSec / (1024 * 1024));
        const remainingBytes = Math.max(0, selectedFile.size - offset);
        setTransferETA(speedBytesPerSec > 0 ? remainingBytes / speedBytesPerSec : 0);
        
        speedUpdateInterval.current = now;
        bytesSinceLastSpeedUpdate.current = 0;
      }

      if (now - lastProgressUpdate.current > 50) {
        let pct = (offset / selectedFile.size) * 100;
        if (selectedFile.isMultiple) pct = Math.min(99, pct);
        setTransferProgress(pct);
        lastProgressUpdate.current = now;
      }
    }
    
    const doneMsg = JSON.stringify({ type: 'control', action: 'done' });
    activeChannels.forEach(dc => {
       if (dc.readyState === 'open') dc.send(doneMsg);
    });
    
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
      const files = Array.from(fileList)
      const totalSize = files.reduce((acc, f) => acc + f.size, 0)
      setSelectedFile({
        isMultiple: true,
        files: files,
        name: 'MiniShare_Files.zip',
        size: totalSize,
        type: 'application/zip'
      })
    }
    setTransferProgress(0)
    setTransferSpeed(0)
    setTransferETA(0)
    setReceivingMeta(null) // clear received meta to show sending UI
  }

  const handleFileChange = (e) => {
    if (e && e.target && e.target.files) {
      processFiles(e.target.files)
    }
  }

  const resetFile = () => {
    setSelectedFile(null)
    setTransferProgress(0)
    setTransferSpeed(0)
    setTransferETA(0)
    setReceivingMeta(null)
    setIsWaitingForReceiver(false)
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
          setReceivingMeta(null)
          setIsZipping(false)
        })
      } else {
        const filePromises = fileEntries.map(entry => {
          return new Promise(resolve => {
            entry.file(f => {
              const path = entry.fullPath.startsWith('/') ? entry.fullPath.slice(1) : entry.fullPath
              resolve({ name: path, input: f, size: f.size })
            })
          })
        })
        const filesForZip = await Promise.all(filePromises)
        const totalSize = filesForZip.reduce((acc, f) => acc + f.size, 0)
        
        setSelectedFile({
          isMultiple: true,
          files: filesForZip,
          name: 'MiniShare_Folder.zip',
          size: totalSize,
          type: 'application/zip'
        })
        setTransferProgress(0)
        setTransferSpeed(0)
        setTransferETA(0)
        setReceivingMeta(null)
        setIsZipping(false)
      }
    } else if (e.dataTransfer.files) {
      processFiles(e.dataTransfer.files)
    }
  }

  const sendMessage = (text) => {
    const activeChannels = Object.values(dataChannels.current).filter(dc => dc.readyState === 'open');
    if (activeChannels.length > 0) {
      const msg = { type: 'chat', text, sender: 'me', timestamp: Date.now() }
      activeChannels.forEach(dc => dc.send(JSON.stringify(msg)))
      setMessages(prev => [...prev, msg])
    }
  }

  const togglePause = () => {
    const newState = !isPaused;
    setIsPaused(newState);
    isPausedRef.current = newState;
    const activeChannels = Object.values(dataChannels.current).filter(dc => dc.readyState === 'open');
    activeChannels.forEach(dc => dc.send(JSON.stringify({ type: 'control', action: newState ? 'pause' : 'resume' })))
  }

  const handleGoHome = () => {
    setAppState('idle')
    setRoomCode('')
    setJoinCodeInput('')
    window.history.pushState({}, '', `/`)
    Object.values(peerConnections.current).forEach(pc => pc.close())
    peerConnections.current = {}
    dataChannels.current = {}
    setPeers([])
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
                  setShowRules={setShowRules}
                  handleFileChange={handleFileChange}
                />
              )}

              {appState === 'waiting' && (
                <WaitingRoom roomCode={roomCode} />
              )}

              {appState === 'in-room' && (
                <TransferSession 
                  connectionStatus={connectionStatus}
                  peerCount={peers.length}
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
                  resetFile={resetFile}
                  isWaitingForReceiver={isWaitingForReceiver}
                  acceptTransfer={acceptTransfer}
                  isTransferAccepted={isTransferAccepted}
                />
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      </div>
      
      {/* Expanded Content Sections (Visible only on idle) */}
      {appState === 'idle' && (
        <div className="w-full bg-white z-10">
          
          {/* Detailed How to Use Section */}
          <div className="w-full max-w-6xl mx-auto px-4 sm:px-8 py-24">
            <div className="text-center mb-20">
              <h2 className="text-4xl sm:text-5xl font-extrabold text-slate-900 tracking-tight mb-4">How to Use MiniShare</h2>
              <p className="text-xl text-slate-500 max-w-2xl mx-auto">A seamless peer-to-peer file transfer experience. No accounts, no limits, no central servers.</p>
            </div>
            
            <div className="space-y-24">
              {/* Step 1 */}
              <div className="flex flex-col md:flex-row items-center gap-12 lg:gap-24 group">
                <div className="flex-1 space-y-6">
                  <div className="w-16 h-16 bg-brand-100 text-brand-600 rounded-2xl flex items-center justify-center text-2xl font-bold shadow-inner border border-brand-200">1</div>
                  <h3 className="text-3xl font-bold text-slate-800 tracking-tight">Create a Room</h3>
                  <p className="text-lg text-slate-600 leading-relaxed">
                    Click the <span className="font-semibold text-brand-600 bg-brand-50 px-2 py-1 rounded-md">Select files to share</span> button at the top of the page. Choose one or multiple files of any size from your device. MiniShare will instantly generate a unique 6-digit room code and a QR code for your secure transfer session.
                  </p>
                </div>
                <div className="flex-1 w-full relative">
                  <div className="absolute inset-0 bg-brand-100 rounded-[2rem] transform rotate-3 scale-105 transition-transform duration-500 group-hover:rotate-6"></div>
                  <div className="relative bg-white border border-slate-200 p-8 rounded-[2rem] shadow-xl text-center space-y-4">
                    <div className="text-6xl font-mono font-bold text-brand-600 tracking-[0.2em] py-8">A4B9F2</div>
                    <div className="w-32 h-32 bg-slate-100 rounded-xl mx-auto border-4 border-white shadow-md flex items-center justify-center">
                      <div className="grid grid-cols-3 gap-1 w-16 h-16 opacity-30"><div className="bg-black"/><div className="bg-white"/><div className="bg-black"/><div className="bg-black"/><div className="bg-black"/><div className="bg-white"/><div className="bg-white"/><div className="bg-black"/><div className="bg-black"/></div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex flex-col md:flex-row-reverse items-center gap-12 lg:gap-24 group">
                <div className="flex-1 space-y-6">
                  <div className="w-16 h-16 bg-purple-100 text-purple-600 rounded-2xl flex items-center justify-center text-2xl font-bold shadow-inner border border-purple-200">2</div>
                  <h3 className="text-3xl font-bold text-slate-800 tracking-tight">Receiver Joins</h3>
                  <p className="text-lg text-slate-600 leading-relaxed">
                    The receiver opens MiniShare on their device. They can either type the 6-digit room code into the <span className="font-semibold text-slate-700 bg-slate-100 px-2 py-1 rounded-md">Enter Room Code</span> box and click Join, or simply scan your QR code with their mobile camera to connect instantly.
                  </p>
                </div>
                <div className="flex-1 w-full relative">
                  <div className="absolute inset-0 bg-purple-100 rounded-[2rem] transform -rotate-3 scale-105 transition-transform duration-500 group-hover:-rotate-6"></div>
                  <div className="relative bg-white border border-slate-200 p-8 rounded-[2rem] shadow-xl text-center space-y-6">
                    <input disabled value="A4B9F2" className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-4 px-4 text-center tracking-[0.2em] text-lg font-medium text-slate-800" />
                    <button disabled className="w-full bg-slate-200 text-slate-500 font-medium py-4 rounded-2xl flex items-center justify-center gap-2">
                       Join Room
                    </button>
                  </div>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex flex-col md:flex-row items-center gap-12 lg:gap-24 group">
                <div className="flex-1 space-y-6">
                  <div className="w-16 h-16 bg-green-100 text-green-600 rounded-2xl flex items-center justify-center text-2xl font-bold shadow-inner border border-green-200">3</div>
                  <h3 className="text-3xl font-bold text-slate-800 tracking-tight">Direct Transfer</h3>
                  <p className="text-lg text-slate-600 leading-relaxed">
                    Once connected, a secure WebRTC tunnel is established directly between the two devices. The transfer starts automatically! You'll see real-time speed and progress bars. <br/><br/>
                    <strong className="text-slate-800 font-semibold bg-amber-100 px-2 py-1 rounded-md">Important:</strong> Keep your browser tab open until the transfer reaches 100%. The receiver will automatically download the file once completed.
                  </p>
                </div>
                <div className="flex-1 w-full relative">
                  <div className="absolute inset-0 bg-green-100 rounded-[2rem] transform rotate-3 scale-105 transition-transform duration-500 group-hover:rotate-6"></div>
                  <div className="relative bg-white border border-slate-200 p-8 rounded-[2rem] shadow-xl space-y-4">
                    <div className="flex justify-between items-center text-sm font-semibold text-slate-700">
                      <span>Sending to 1 peer...</span>
                      <span>68%</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                      <div className="h-full bg-green-500 w-[68%]"></div>
                    </div>
                    <div className="flex justify-between text-xs text-slate-500 mt-2">
                      <span>Speed: 12.5 MB/s</span>
                      <span>ETA: 4s</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Troubleshooting Section */}
          <div className="w-full bg-slate-50 border-y border-slate-200">
            <div className="w-full max-w-6xl mx-auto px-4 sm:px-8 py-20">
              <h2 className="text-3xl font-bold text-slate-900 text-center mb-12 tracking-tight">Troubleshooting & Tips</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                  <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mb-4 text-2xl font-bold">?</div>
                  <h3 className="text-lg font-bold text-slate-800 mb-2">Button doing nothing?</h3>
                  <p className="text-sm text-slate-600 leading-relaxed">If clicking 'Select files' or 'Join' does nothing, the connection server might be waking up. Please wait about 30-45 seconds, refresh the page, and try again.</p>
                </div>
                
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                  <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mb-4 text-2xl font-bold">📱</div>
                  <h3 className="text-lg font-bold text-slate-800 mb-2">Different Networks?</h3>
                  <p className="text-sm text-slate-600 leading-relaxed">MiniShare works seamlessly across different networks (like Wi-Fi to 5G). If a strict firewall blocks the direct connection, we automatically route your transfer securely to ensure it succeeds.</p>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                  <div className="w-12 h-12 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center mb-4 text-2xl font-bold">⏸️</div>
                  <h3 className="text-lg font-bold text-slate-800 mb-2">Keep the app open</h3>
                  <p className="text-sm text-slate-600 leading-relaxed">For the fastest and most stable transfer, keep the browser tab active on both devices. If the transfer pauses because a device goes to sleep, just wake it up and click Resume.</p>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                  <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-4 text-2xl font-bold">🔒</div>
                  <h3 className="text-lg font-bold text-slate-800 mb-2">Using an iPhone?</h3>
                  <p className="text-sm text-slate-600 leading-relaxed">Apple's iOS requires a secure connection to share files. Always make sure you are using the secure version of the site (the URL in your browser should begin with https://).</p>
                </div>
              </div>
            </div>
          </div>

          <div className="w-full max-w-4xl mx-auto px-4 sm:px-8 py-24">
            <h2 className="text-3xl font-bold text-slate-900 text-center mb-12 tracking-tight">Frequently Asked Questions</h2>
            
            <div className="space-y-6">
              <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200 hover:shadow-md transition-shadow">
                <h3 className="text-lg font-semibold text-slate-800 mb-2">Are my files stored on your servers?</h3>
                <p className="text-slate-600">Never. MiniShare uses WebRTC to establish a direct connection between you and the receiver. Your data goes straight from your device to theirs without stopping anywhere in between.</p>
              </div>
              <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200 hover:shadow-md transition-shadow">
                <h3 className="text-lg font-semibold text-slate-800 mb-2">Is there really no file size limit?</h3>
                <p className="text-slate-600">Technically, yes! Because files transfer directly between devices, there are no artificial limits. However, for mobile devices, we recommend keeping transfers under <strong className="text-slate-800 font-medium">4GB</strong> to prevent your mobile browser from falling asleep and dropping the connection. For PC to PC, it is virtually unlimited!</p>
              </div>
              <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200 hover:shadow-md transition-shadow">
                <h3 className="text-lg font-semibold text-slate-800 mb-2">Is it secure?</h3>
                <p className="text-slate-600">Yes. The WebRTC connection is End-to-End Encrypted by default using Datagram Transport Layer Security (DTLS). Nobody, not even us, can intercept or read the files you send.</p>
              </div>
              <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200 hover:shadow-md transition-shadow">
                <h3 className="text-lg font-semibold text-slate-800 mb-2">Does it work on all devices?</h3>
                <p className="text-slate-600">Yes! MiniShare runs entirely in your web browser. It is fully compatible with Windows, Mac, Linux, Android, and iOS (iPhone/iPad). As long as you have a modern web browser, you can share files seamlessly across any combination of devices.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer info */}
      <div className="w-full bg-slate-900 text-slate-400 text-sm py-8 text-center z-10">
        &copy; {new Date().getFullYear()} MiniShare. Built with React and WebRTC.
      </div>

      {/* Rules Modal */}
      <AnimatePresence>
        {showRules && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
              onClick={() => setShowRules(false)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-[2rem] shadow-2xl overflow-hidden"
            >
              <div className="p-6 sm:p-8">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                    <Info className="w-6 h-6 text-brand-600" /> 
                    Usage Guidelines
                  </h3>
                  <button 
                    onClick={() => setShowRules(false)}
                    className="p-2 text-slate-400 hover:text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-full transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                
                <div className="space-y-4 text-slate-600 leading-relaxed">
                  <div className="flex gap-3">
                    <span className="font-bold text-brand-600">1.</span>
                    <p><strong>Keep your tab open:</strong> Transfers happen directly between browsers. If either the sender or receiver closes the tab, the transfer will fail.</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="font-bold text-purple-600">2.</span>
                    <p><strong>Device sleeping:</strong> Prevent your phone or computer from going to sleep while transferring large files. This can pause or break the connection.</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="font-bold text-blue-600">3.</span>
                    <p><strong>Size limits:</strong> While PC-to-PC transfers are virtually unlimited, we recommend keeping mobile transfers under 4GB to prevent browser crashes.</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="font-bold text-green-600">4.</span>
                    <p><strong>Security:</strong> All files are End-to-End Encrypted. We do not store your files on any server, ensuring total privacy.</p>
                  </div>
                </div>
                
                <div className="mt-8">
                  <button 
                    onClick={() => setShowRules(false)}
                    className="w-full bg-slate-900 hover:bg-slate-800 text-white font-medium py-3 rounded-xl transition-colors"
                  >
                    Got it, thanks!
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default App
