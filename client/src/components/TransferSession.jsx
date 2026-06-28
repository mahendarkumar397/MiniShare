import { motion } from 'framer-motion'
import { FileUp, File as FileIcon, Download, CheckCircle, Loader2, Users } from 'lucide-react'
import AnalyticsCard from './AnalyticsCard'

export default function TransferSession({
  connectionStatus,
  peerCount,
  selectedFile,
  handleFileDrop,
  handleFileChange,
  transferProgress,
  transferSpeed,
  transferETA,
  isZipping,
  sendFile,
  receivingMeta,
  messages,
  sendMessage,
  isPaused,
  togglePause,
  resetFile,
  acceptTransfer,
  isTransferAccepted,
  isWaitingForReceiver
}) {
  return (
    <motion.div 
      key="in-room" 
      initial={{ opacity: 0, scale: 0.95 }} 
      animate={{ opacity: 1, scale: 1 }} 
      exit={{ opacity: 0, scale: 0.95 }} 
      className="space-y-6"
    >
      <div className={`p-4 border rounded-2xl flex items-center gap-4 transition-colors shadow-sm ${connectionStatus === 'connected' ? 'bg-green-50/50 border-green-200' : 'bg-brand-50/50 border-brand-200'}`}>
        {connectionStatus === 'connected' ? (
          <CheckCircle className="w-6 h-6 text-green-500 shrink-0" />
        ) : (
          <Loader2 className="w-6 h-6 text-brand-500 animate-spin shrink-0" />
        )}
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-slate-800">
            {connectionStatus === 'connected' ? 'Secure P2P Mesh Network' : 'Connecting to Peers...'}
          </h3>
          <p className="text-xs text-slate-500">
            {connectionStatus === 'connected' ? 'End-to-End Encrypted' : 'Negotiating WebRTC details'}
          </p>
        </div>
        {connectionStatus === 'connected' && (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-bold">
            <Users className="w-3.5 h-3.5" />
            {peerCount} {peerCount === 1 ? 'Peer' : 'Peers'}
          </div>
        )}
      </div>

      {connectionStatus === 'connected' && (
        <div className="space-y-4">
          {receivingMeta ? (
            <div className="bg-white border border-slate-200 shadow-sm rounded-2xl p-5">
              <div className="flex items-center gap-4 mb-5">
                <div className="p-3 bg-green-50 rounded-xl border border-green-100">
                  <Download className="w-6 h-6 text-green-600" />
                </div>
                <div className="flex-1 overflow-hidden">
                  <p className="text-sm font-semibold text-slate-800 truncate">{receivingMeta.name}</p>
                  <p className="text-xs text-slate-500">{(receivingMeta.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
                {transferProgress === 100 && (
                  <button 
                    onClick={resetFile}
                    className="text-xs text-brand-600 hover:text-brand-700 font-medium px-3 py-1.5 bg-brand-50 rounded-lg"
                  >
                    Done
                  </button>
                )}
              </div>
              {isTransferAccepted ? (
                <div className="space-y-2 mt-6">
                  <div className="flex justify-between items-center text-sm font-semibold text-slate-700">
                    <div className="flex items-center gap-2">
                      <span>{transferProgress === 100 ? "Completed" : "Receiving..."}</span>
                      {transferProgress > 0 && transferProgress < 100 && (
                        <button onClick={togglePause} className="px-2 py-0.5 text-xs bg-slate-200 hover:bg-slate-300 rounded text-slate-700">
                          {isPaused ? 'Resume' : 'Pause'}
                        </button>
                      )}
                    </div>
                    <span>{Math.round(transferProgress)}%</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                    <motion.div 
                      className={`h-full ${transferProgress === 100 ? 'bg-green-500' : 'bg-brand-500'}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${transferProgress}%` }}
                      transition={{ ease: "linear", duration: 0.2 }}
                    />
                  </div>
                  {transferProgress < 100 && (
                    <AnalyticsCard transferSpeed={transferSpeed} transferETA={transferETA} />
                  )}
                </div>
              ) : (
                <div className="mt-6">
                  <button 
                    onClick={() => acceptTransfer(receivingMeta.peerId)}
                    className="w-full bg-green-500 hover:bg-green-600 text-white font-medium py-3 rounded-xl transition-all shadow-md"
                  >
                    Accept Transfer
                  </button>
                </div>
              )}
            </div>
          ) : selectedFile ? (
            <div className="bg-white border border-slate-200 shadow-sm rounded-2xl p-5">
              <div className="flex items-center gap-4 mb-5">
                <div className="p-3 bg-brand-50 rounded-xl border border-brand-100">
                  <FileIcon className="w-6 h-6 text-brand-600" />
                </div>
                <div className="flex-1 overflow-hidden">
                  <p className="text-sm font-semibold text-slate-800 truncate">{selectedFile.name || "Multiple Files"}</p>
                  <p className="text-xs text-slate-500">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
                {transferProgress === 100 && (
                  <button 
                    onClick={resetFile}
                    className="text-xs text-brand-600 hover:text-brand-700 font-medium px-3 py-1.5 bg-brand-50 rounded-lg"
                  >
                    Send Another
                  </button>
                )}
              </div>
              
              {transferProgress > 0 ? (
                <div className="space-y-2 mt-6">
                  <div className="flex justify-between items-center text-sm font-semibold text-slate-700">
                    <div className="flex items-center gap-2">
                      <span>{transferProgress === 100 ? "Completed" : `Sending to ${peerCount} peers...`}</span>
                      {transferProgress > 0 && transferProgress < 100 && (
                        <button onClick={togglePause} className="px-2 py-0.5 text-xs bg-slate-200 hover:bg-slate-300 rounded text-slate-700">
                          {isPaused ? 'Resume' : 'Pause'}
                        </button>
                      )}
                    </div>
                    <span>{Math.round(transferProgress)}%</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                    <motion.div 
                      className={`h-full ${transferProgress === 100 ? 'bg-green-500' : 'bg-brand-500'}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${transferProgress}%` }}
                      transition={{ ease: "linear", duration: 0.2 }}
                    />
                  </div>
                  {transferProgress < 100 && (
                    <AnalyticsCard transferSpeed={transferSpeed} transferETA={transferETA} />
                  )}
                </div>
              ) : (
                <button 
                  onClick={sendFile}
                  disabled={peerCount === 0 || isWaitingForReceiver}
                  className={`w-full font-medium py-3 rounded-xl transition-all shadow-md ${peerCount > 0 && !isWaitingForReceiver ? 'bg-brand-600 hover:bg-brand-700 text-white hover:shadow-lg hover:-translate-y-0.5' : 'bg-slate-300 text-slate-500 cursor-not-allowed'}`}
                >
                  {isWaitingForReceiver ? 'Waiting for receiver to accept...' : (peerCount > 0 ? `Start Transfer to ${peerCount} peers` : 'Waiting for peers...')}
                </button>
              )}
            </div>
          ) : (
            <div 
              className="border-2 border-dashed border-slate-300 rounded-2xl p-10 text-center bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleFileDrop}
              onClick={() => document.getElementById('file-upload').click()}
            >
              <input id="file-upload" type="file" multiple className="hidden" onChange={handleFileChange} onClick={(e) => e.stopPropagation()} />
              
              {isZipping ? (
                <>
                  <div className="w-16 h-16 bg-white shadow-sm rounded-full flex items-center justify-center mx-auto mb-4">
                    <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
                  </div>
                  <h4 className="text-lg font-bold text-slate-800 mb-1">Compressing Files...</h4>
                  <p className="text-sm text-slate-500">Preparing your files for transfer</p>
                </>
              ) : (
                <>
                  <div className="w-16 h-16 bg-white shadow-sm rounded-full flex items-center justify-center mx-auto mb-4">
                    <FileUp className="w-8 h-8 text-brand-500" />
                  </div>
                  <h4 className="text-lg font-bold text-slate-800 mb-1">Select or drop files</h4>
                  <p className="text-sm text-slate-500">Share with {peerCount > 0 ? `${peerCount} peers` : 'everyone in the room'}</p>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Chat UI */}
      {connectionStatus === 'connected' && (
        <div className="bg-white border border-slate-200 shadow-sm rounded-2xl p-4 flex flex-col h-64">
          <h4 className="text-sm font-semibold text-slate-800 mb-2">Room Chat</h4>
          <div className="flex-1 overflow-y-auto mb-3 space-y-2 pr-2">
            {messages.length === 0 ? (
              <p className="text-xs text-slate-400 text-center mt-10">No messages yet. Say hello!</p>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={`flex ${m.sender === 'me' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`px-3 py-2 rounded-lg text-sm max-w-[80%] break-words ${m.sender === 'me' ? 'bg-brand-500 text-white rounded-br-none' : 'bg-slate-100 text-slate-800 rounded-bl-none'}`}>
                    {m.text}
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <input 
              type="text" 
              id="chat-input"
              autoComplete="off"
              className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" 
              placeholder="Type a message..."
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.target.value.trim()) {
                  sendMessage(e.target.value.trim())
                  e.target.value = ''
                }
              }}
            />
            <button 
              onClick={() => {
                const input = document.getElementById('chat-input')
                if (input.value.trim()) {
                  sendMessage(input.value.trim())
                  input.value = ''
                }
              }}
              className="bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 transition-colors font-medium text-sm"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </motion.div>
  )
}
