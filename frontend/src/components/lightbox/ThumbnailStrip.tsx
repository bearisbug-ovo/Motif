import { useRef, useEffect } from 'react'
import { mediaApi } from '@/api/media'
import { useLightboxStore } from '@/stores/lightbox'
import { cn } from '@/lib/utils'

interface ThumbnailStripProps {
  visible: boolean
}

export function ThumbnailStrip({ visible }: ThumbnailStripProps) {
  const { localItems, localIndex, chainIndex, jumpTo } = useLightboxStore()
  const stripRef = useRef<HTMLDivElement>(null)
  const thumbRefs = useRef<(HTMLDivElement | null)[]>([])

  // Auto-scroll to current thumbnail
  useEffect(() => {
    if (!stripRef.current) return
    const thumb = thumbRefs.current[localIndex]
    if (!thumb) return
    const strip = stripRef.current
    const targetLeft = thumb.offsetLeft - strip.clientWidth / 2 + thumb.offsetWidth / 2
    strip.scrollTo({ left: targetLeft, behavior: 'smooth' })
  }, [localIndex])

  if (localItems.length <= 1) return null

  return (
    <div
      ref={stripRef}
      className={cn(
        'h-20 border-t border-white/10 flex items-center gap-1 overflow-x-auto shrink-0 scroll-smooth transition-opacity duration-200',
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="shrink-0" style={{ width: 'calc(50vw - 34px)' }} />
      {localItems.map((m, i) => (
        <div
          key={m.id}
          ref={(el) => { thumbRefs.current[i] = el }}
          className={cn(
            'h-16 w-16 shrink-0 cursor-pointer rounded overflow-hidden border-2 transition-all relative',
            i === localIndex
              ? 'border-primary opacity-100'
              : 'border-transparent opacity-30 hover:opacity-60'
          )}
          onClick={() => jumpTo(m.id)}
        >
          <img
            src={mediaApi.itemThumbUrl(m, 80)}
            alt=""
            className="w-full h-full object-cover"
          />
          {/* Dot indicator when viewing a chain item for this local image */}
          {i === localIndex && chainIndex >= 0 && (
            <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-primary" />
          )}
        </div>
      ))}
      <div className="shrink-0" style={{ width: 'calc(50vw - 34px)' }} />
    </div>
  )
}
