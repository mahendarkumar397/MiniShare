import { Clock, Zap } from 'lucide-react'

export default function AnalyticsCard({ transferSpeed, transferETA }) {
  return (
    <div className="grid grid-cols-2 gap-4 mt-6">
      <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center gap-3 shadow-sm hover:shadow transition-shadow">
        <div className="w-10 h-10 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center shrink-0">
          <Zap className="w-5 h-5" />
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Transfer Speed</p>
          <p className="text-sm font-semibold text-slate-800">{transferSpeed ? transferSpeed.toFixed(2) : '0'} MB/s</p>
        </div>
      </div>
      <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center gap-3 shadow-sm hover:shadow transition-shadow">
        <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center shrink-0">
          <Clock className="w-5 h-5" />
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Estimated Time</p>
          <p className="text-sm font-semibold text-slate-800">{transferETA ? Math.ceil(transferETA) : '0'} sec</p>
        </div>
      </div>
    </div>
  )
}
