import { useRef, useCallback, useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react'
import { mediaApi, MediaItem } from '@/api/media'
import { useLightboxStore } from '@/stores/lightbox'
import { useMediaStore } from '@/stores/media'
import { StarRating } from '../StarRating'
import { VideoPlayer, type VideoPlayerHandle } from '../video/VideoPlayer'
import { useImageZoom } from '@/hooks/useImageZoom'
import { isTouch } from '@/hooks/useDevice'
import { cn } from '@/lib/utils'
import type { TouchArbiter } from '../video/hooks/useTouchArbiter'

interface LightBoxMediaProps {
  immersive: boolean
  isLandscape: boolean
  onToggleLandscape: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onClose: () => void
  sessionUnmuted: boolean
  onSessionUnmute: () => void
  onVideoScreenshot: (blob: Blob, timestamp: number) => void
  touchArbiter: React.MutableRefObject<TouchArbiter>
  videoPlayerRef: React.RefObject<VideoPlayerHandle>
  imgContainerRef: React.RefObject<HTMLDivElement>
  mainImgRef: React.RefObject<HTMLImageElement>
  zoom: ReturnType<typeof useImageZoom>
  mobileRatingPopup: boolean
}

export function LightBoxMedia({
  immersive, isLandscape, onToggleLandscape, onContextMenu, onClose,
  sessionUnmuted, onSessionUnmute, onVideoScreenshot,
  touchArbiter, videoPlayerRef, imgContainerRef, mainImgRef, zoom,
  mobileRatingPopup,
}: LightBoxMediaProps) {
  const { currentItem: item, localItems, localIndex, navigateH } = useLightboxStore()
  const { updateMedia } = useMediaStore()
  const [videoMuted, setVideoMuted] = useState(!sessionUnmuted)
  const [imgError, setImgError] = useState(false)

  // Reset error state when item changes
  useEffect(() => { setImgError(false) }, [item?.id])

  const isVideo = item?.media_type === 'video'
  const isFirst = localIndex === 0
  const isLast = localIndex >= localItems.length - 1

  const handleImageTap = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (isTouch) {
      // Mobile: toggle handled by parent
    }
  }, [])

  if (!item) return null

  return (
    <div
      className="flex-1 flex items-center justify-center relative overflow-hidden"
      onClick={(e) => { if (!zoom.isZoomed) { e.stopPropagation(); onClose() } }}
      onContextMenu={onContextMenu}
    >
      {/* Left nav strip */}
      {!isFirst && !isTouch && (
        <div
          className={cn("absolute left-0 top-0 w-28 z-10 hidden sm:flex items-center justify-center group/nav", isVideo ? "bottom-12" : "bottom-0")}
          style={{ cursor: `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\' viewBox=\'0 0 24 24\'><path d=\'M15 4l-8 8 8 8\' stroke=\'white\' stroke-width=\'2.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\' fill=\'none\'/><path d=\'M15 4l-8 8 8 8\' stroke=\'black\' stroke-width=\'0.8\' stroke-linecap=\'round\' stroke-linejoin=\'round\' fill=\'none\' opacity=\'0.3\'/></svg>')}") 12 12, pointer` }}
          onClick={(e) => { e.stopPropagation(); navigateH(-1) }}
        >
          <div className="absolute inset-0 bg-white/20 opacity-0 group-hover/nav:opacity-100 transition-opacity duration-200 rounded-r" />
          <ChevronLeft className="w-7 h-7 text-white/0 group-hover/nav:text-white/90 transition-colors duration-200 drop-shadow-lg relative" />
        </div>
      )}

      {isVideo ? (
        <VideoPlayer
          ref={videoPlayerRef}
          src={mediaApi.serveUrl(item.file_path)}
          poster={mediaApi.itemThumbUrl(item, 800)}
          autoPlay
          initialMuted={!sessionUnmuted}
          initialTime={item.playback_position ?? undefined}
          onMutedChange={(m) => {
            setVideoMuted(m)
            if (!m) onSessionUnmute()
          }}
          onProgressSave={(time) => mediaApi.saveProgress(item.id, time).catch(() => {})}
          onScreenshot={onVideoScreenshot}
          isLandscape={isLandscape}
          onLandscapeChange={onToggleLandscape}
          touchArbiter={touchArbiter}
        />
      ) : (
        <div
          ref={imgContainerRef}
          className="absolute inset-0 overflow-hidden"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const cx = e.clientX - rect.left
            const cy = e.clientY - rect.top
            if (!zoom.isZoomed && !zoom.isPointOnImage(cx, cy)) return
            e.stopPropagation()
            if (isTouch) handleImageTap(e)
          }}
        >
          {imgError ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/60">
              <AlertTriangle className="w-12 h-12" />
              <p className="text-sm">文件不存在或无法加载</p>
              <p className="text-xs text-white/40">右键菜单 → 重新定位文件</p>
            </div>
          ) : (
            <>
              <img
                ref={mainImgRef}
                src={mediaApi.serveUrl(item.file_path)}
                alt=""
                className="select-none"
                draggable={false}
                onError={() => setImgError(true)}
              />
              <div
                data-zoom-indicator
                className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/60 text-white/70 text-xs px-3 py-1 rounded-full pointer-events-none transition-opacity duration-200"
                style={{ opacity: 0 }}
              />
            </>
          )}
        </div>
      )}

      {/* Right nav strip */}
      {!isLast && !isTouch && (
        <div
          className={cn("absolute right-0 top-0 w-28 z-10 hidden sm:flex items-center justify-center group/nav", isVideo ? "bottom-12" : "bottom-0")}
          style={{ cursor: `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\' viewBox=\'0 0 24 24\'><path d=\'M9 4l8 8-8 8\' stroke=\'white\' stroke-width=\'2.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\' fill=\'none\'/><path d=\'M9 4l8 8-8 8\' stroke=\'black\' stroke-width=\'0.8\' stroke-linecap=\'round\' stroke-linejoin=\'round\' fill=\'none\' opacity=\'0.3\'/></svg>')}") 12 12, pointer` }}
          onClick={(e) => { e.stopPropagation(); navigateH(1) }}
        >
          <div className="absolute inset-0 bg-white/20 opacity-0 group-hover/nav:opacity-100 transition-opacity duration-200 rounded-l" />
          <ChevronRight className="w-7 h-7 text-white/0 group-hover/nav:text-white/90 transition-colors duration-200 drop-shadow-lg relative" />
        </div>
      )}

      {/* Mobile immersive rating popup */}
      {immersive && mobileRatingPopup && item && (
        <div
          className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-black/70 rounded-lg px-4 py-2"
          onClick={(e) => e.stopPropagation()}
        >
          <StarRating value={item.rating} size="md" onChange={(r) => updateMedia(item.id, { rating: r })} />
        </div>
      )}
    </div>
  )
}
