import { Lock, FastForward } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SpeedIndicatorProps {
  rate: number
  isActive: boolean
  isLocked: boolean
  shouldLock: boolean
}

export function SpeedIndicator({ rate, isActive, isLocked, shouldLock }: SpeedIndicatorProps) {
  // Show when speed != 1x (active long-press or locked)
  const show = isActive || (isLocked && rate !== 1)

  return (
    <div
      className={cn(
        'absolute top-4 left-1/2 -translate-x-1/2 z-10 transition-all duration-200',
        show ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'
      )}
    >
      <div className="flex items-center gap-1.5 bg-black/70 backdrop-blur-sm rounded-full px-3 py-1.5">
        <FastForward className="w-3.5 h-3.5 text-white/80" />
        <span className="text-sm font-medium text-white tabular-nums">
          {rate.toFixed(2)}x
        </span>
        {(isLocked || shouldLock) && (
          <Lock className={cn(
            'w-3 h-3 transition-colors',
            shouldLock ? 'text-yellow-400' : 'text-white/60'
          )} />
        )}
      </div>
    </div>
  )
}
