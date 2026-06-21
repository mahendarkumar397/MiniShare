import { motion } from 'framer-motion'
import { Send, Download, Info } from 'lucide-react'

export default function HomeView({ 
  handleCreateRoom, 
  handleJoinRoom, 
  joinCodeInput, 
  setJoinCodeInput, 
  error,
  setShowRules
}) {
  return (
    <motion.div 
      key="idle" 
      initial={{ opacity: 0, y: 20 }} 
      animate={{ opacity: 1, y: 0 }} 
      exit={{ opacity: 0, y: -20 }} 
      className="space-y-8"
    >
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-semibold text-slate-800">Share files securely</h2>
        <p className="text-slate-500">Peer to peer, no file size limits.</p>
        <button 
          onClick={() => setShowRules(true)}
          className="inline-flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-700 font-medium transition-colors mt-2 bg-brand-50 hover:bg-brand-100 px-3 py-1 rounded-full"
        >
          <Info className="w-4 h-4" /> Usage Guidelines
        </button>
      </div>

      <div className="space-y-6">
        <button 
          onClick={handleCreateRoom} 
          className="w-full bg-brand-600 hover:bg-brand-700 text-white font-medium py-4 px-4 rounded-2xl transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 flex items-center justify-center gap-2 text-lg"
        >
          <Send className="w-5 h-5" /> Select files to share
        </button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-200"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-4 bg-white text-slate-400">or receive files</span>
          </div>
        </div>

        <form onSubmit={handleJoinRoom} className="space-y-4">
          <input 
            type="text" 
            value={joinCodeInput} 
            onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())} 
            placeholder="Enter Room Code" 
            className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-4 px-4 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500 transition-all text-center tracking-[0.2em] text-lg uppercase font-medium" 
            maxLength={6} 
          />
          <button 
            type="submit" 
            disabled={joinCodeInput.length === 0} 
            className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium py-4 px-4 rounded-2xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-lg border border-slate-200"
          >
            <Download className="w-5 h-5" /> Join Room
          </button>
        </form>
      </div>

      {error && (
        <motion.div 
          initial={{ opacity: 0, height: 0 }} 
          animate={{ opacity: 1, height: 'auto' }}
          className="text-red-600 text-sm text-center bg-red-50 py-3 px-4 rounded-xl border border-red-100"
        >
          {error}
        </motion.div>
      )}
    </motion.div>
  )
}
