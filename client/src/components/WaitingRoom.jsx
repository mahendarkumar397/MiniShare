import { useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2, Copy, Check } from 'lucide-react'
import QRCode from 'react-qr-code'

export default function WaitingRoom({ roomCode }) {
  const [copied, setCopied] = useState(false)
  const shareUrl = `${window.location.origin}/${roomCode}`

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy', err)
    }
  }

  return (
    <motion.div 
      key="waiting" 
      initial={{ opacity: 0, scale: 0.95 }} 
      animate={{ opacity: 1, scale: 1 }} 
      exit={{ opacity: 0, scale: 0.95 }} 
      className="text-center space-y-8"
    >
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold text-slate-800">Scan to connect</h2>
        <p className="text-slate-500">Scan this code or share the link below with the receiver.</p>
      </div>

      <div className="flex flex-col items-center justify-center py-2">
         <p className="text-xs text-slate-400 font-bold tracking-widest uppercase mb-1">Room Code</p>
         <div className="text-4xl font-mono font-bold text-brand-600 tracking-[0.2em]">{roomCode}</div>
      </div>

      <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm inline-block mx-auto">
        <div className="bg-white p-2 rounded-xl">
          <QRCode 
            value={shareUrl} 
            size={200}
            level="H"
            className="mx-auto"
            fgColor="#0f172a"
          />
        </div>
      </div>

      <div className="space-y-4 max-w-sm mx-auto">
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 p-2 rounded-xl">
          <div className="flex-1 truncate px-2 text-slate-600 font-mono text-sm">
            {shareUrl}
          </div>
          <button 
            onClick={handleCopy}
            className="p-2 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-lg transition-colors flex shrink-0"
            title="Copy link"
          >
            {copied ? <Check className="w-5 h-5 text-green-600" /> : <Copy className="w-5 h-5" />}
          </button>
        </div>

        <div className="flex items-center justify-center gap-3 text-brand-600 font-medium bg-brand-50 py-3 rounded-xl border border-brand-100">
          <Loader2 className="w-5 h-5 animate-spin" />
          <p>Waiting for receiver...</p>
        </div>
      </div>
    </motion.div>
  )
}
