import { useState, useRef } from 'react'
import { cn } from '@/lib/utils'

interface StarRatingProps {
  value: number | null
  onChange?: (v: number | null) => void
  size?: 'sm' | 'md'
  readonly?: boolean
}

// Refined palette: subtle low tiers, beautiful warm 4★, luxurious 5★
const STAR_COLORS: Record<number, { fill: string; stroke: string; glow?: string }> = {
  1: { fill: '#9094A6', stroke: '#7E829A' },                       // cool gray
  2: { fill: '#7CA3C4', stroke: '#6890B0' },                       // soft steel blue
  3: { fill: '#A78DC6', stroke: '#9478B8' },                       // lavender
  4: { fill: '#D4A84B', stroke: '#C49835', glow: '#D4A84B' },      // warm gold
  5: { fill: 'url(#star-gradient-5)', stroke: '#C77DB0' },         // rose-gold gradient
}

function StarIcon({ filled, color, glow, className, ratingLevel }: {
  filled: boolean
  color: { fill: string; stroke: string; glow?: string }
  glow?: string
  className?: string
  ratingLevel: number
}) {
  return (
    <svg viewBox="0 0 24 24" className={className}>
      <defs>
        {/* 5★ gradient — vivid rose-gold-lavender */}
        <linearGradient id="star-gradient-5" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#E8A0C0" />
          <stop offset="35%" stopColor="#D4A0D8" />
          <stop offset="65%" stopColor="#A8B8E8" />
          <stop offset="100%" stopColor="#E0C080" />
        </linearGradient>
        {/* 4★ glow filter */}
        {glow && (
          <filter id={`star-glow-${ratingLevel}`}>
            <feGaussianBlur stdDeviation="1.5" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        )}
      </defs>
      <path
        d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
        fill={filled ? color.fill : 'none'}
        stroke={filled ? color.stroke : 'currentColor'}
        strokeWidth="1.5"
        strokeLinejoin="round"
        filter={filled && glow ? `url(#star-glow-${ratingLevel})` : undefined}
      />
    </svg>
  )
}

export function StarRating({ value, onChange, size = 'sm', readonly = false }: StarRatingProps) {
  const sz = size === 'sm' ? 'w-3.5 h-3.5' : 'w-5 h-5'
  const [popStar, setPopStar] = useState<number | null>(null)
  const popTimeout = useRef<ReturnType<typeof setTimeout>>()

  const rating = value ?? 0
  const color = rating > 0 ? STAR_COLORS[rating] : STAR_COLORS[1]

  const handleClick = (star: number) => {
    if (readonly) return
    const newVal = value === star ? null : star
    onChange?.(newVal)

    setPopStar(star)
    clearTimeout(popTimeout.current)
    popTimeout.current = setTimeout(() => setPopStar(null), 400)
  }

  return (
    <div className="flex gap-0.5 items-center">
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = rating >= star
        const starColor = filled ? color : STAR_COLORS[1]
        const isPop = popStar === star
        const hasGlow = filled && rating >= 4 && color.glow

        return (
          <span
            key={star}
            className={cn(
              sz,
              'transition-transform duration-150 inline-block',
              !readonly && 'cursor-pointer hover:scale-125',
              isPop && 'animate-star-pop',
              filled && rating === 5 && 'animate-star-shimmer',
              filled && rating === 4 && 'animate-star-pulse',
            )}
            onClick={(e) => { e.stopPropagation(); handleClick(star) }}
          >
            <StarIcon
              filled={filled}
              color={starColor}
              glow={hasGlow ? color.glow : undefined}
              className={cn(sz, !filled && 'text-muted-foreground')}
              ratingLevel={rating}
            />
          </span>
        )
      })}
    </div>
  )
}
