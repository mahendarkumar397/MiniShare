import { motion } from 'framer-motion'
import { FileUp, File as FileIcon, Download, CheckCircle, Loader2 } from 'lucide-react'

export default function TransferSession({
  connectionStatus,
  isSender,
  selectedFile,
  handleFileDrop,
  handleFileChange,
  transferProgress,
  sendFile,
  receivingMeta
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
        <div>
          <h3 className="text-sm font-semibold text-slate-800">
            {connectionStatus === 'connected' ? 'Secure P2P Connection' : 'Connecting to Peer...'}
          </h3>
          <p className="text-xs text-slate-500">
            {connectionStatus === 'connected' ? 'End-to-End Encrypted' : 'Negotiating WebRTC details'}
          </p>
        </div>
      </div>

      {connectionStatus === 'connected' && isSender && (
        <div className="space-y-4">
          {!selectedFile ? (
            <div 
              className="border-2 border-dashed border-slate-300 rounded-2xl p-10 text-center bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleFileDrop}
              onClick={() => document.getElementById('file-upload').click()}
            >
              <input id="file-upload" type="file" className="hidden" onChange={(e) => handleFileChange(e.target.files[0])} />
              <div className="w-16 h-16 bg-white shadow-sm rounded-full flex items-center justify-center mx-auto mb-4">
                <FileUp className="w-8 h-8 text-brand-500" />
              </div>
              <p className="text-slate-800 font-semibold mb-1 text-lg">Click to select or drag & drop</p>
              <p className="text-sm text-slate-500">Send any file size securely</p>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 shadow-sm rounded-2xl p-5">
              <div className="flex items-center gap-4 mb-5">
                <div className="p-3 bg-brand-50 rounded-xl border border-brand-100">
                  <FileIcon className="w-6 h-6 text-brand-600" />
                </div>
                <div className="flex-1 overflow-hidden">
                  <p className="text-sm font-semibold text-slate-800 truncate">{selectedFile.name}</p>
                  <p className="text-xs text-slate-500">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
                {transferProgress === 100 && (
                  <button 
                    onClick={() => handleFileChange(null)}
                    className="text-xs text-brand-600 hover:text-brand-700 font-medium px-3 py-1.5 bg-brand-50 rounded-lg"
                  >
                    Send Another
                  </button>
                )}
              </div>
              
              {transferProgress > 0 ? (
                <div className="space-y-3">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className={transferProgress === 100 ? "text-green-600" : "text-brand-600"}>
                      {transferProgress === 100 ? "Sent Successfully" : "Sending..."}
                    </span>
                    <span className="text-slate-700">{Math.round(transferProgress)}%</span>
                  </div>
                  <div className="h-3 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                    <motion.div 
                      className={`h-full ${transferProgress === 100 ? 'bg-green-500' : 'bg-brand-500'}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${transferProgress}%` }}
                    />
                  </div>
                </div>
              ) : (
                <button 
                  onClick={sendFile}
                  className="w-full bg-brand-600 hover:bg-brand-700 text-white font-medium py-3 rounded-xl transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5"
                >
                  Start Transfer
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {connectionStatus === 'connected' && !isSender && (
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
              </div>
              
              <div className="space-y-3">
                <div className="flex justify-between text-xs font-semibold">
                  <span className={transferProgress === 100 ? "text-green-600" : "text-brand-600"}>
                    {transferProgress === 100 ? "Completed & Downloaded" : "Receiving..."}
                  </span>
                  <span className="text-slate-700">{Math.round(transferProgress)}%</span>
                </div>
                <div className="h-3 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                  <motion.div 
                    className={`h-full ${transferProgress === 100 ? "bg-green-500" : "bg-brand-500"}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${transferProgress}%` }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="border-2 border-dashed border-slate-300 rounded-2xl p-10 text-center bg-slate-50">
              <div className="w-16 h-16 bg-white shadow-sm rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-100">
                <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
              </div>
              <p className="text-slate-800 font-semibold text-lg">Waiting for sender...</p>
              <p className="text-sm text-slate-500 mt-1">They are selecting a file to send</p>
            </div>
          )}
        </div>
      )}
    </motion.div>
  )
}
