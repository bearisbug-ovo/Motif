import { useEffect, useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X, ChevronLeft, ChevronRight, Trash2, ImageIcon, Star,
  Maximize, Minimize, FolderInput, FolderOpen,
  Shuffle, Briefcase,
  Unlink, GitBranch, Volume2, VolumeX, Info,
} from 'lucide-react'
import { mediaApi, MediaItem } from '@/api/media'
import { useMediaStore } from '@/stores/media'
import { useAlbumStore } from '@/stores/album'
import { usePersonStore } from '@/stores/person'
import { useWorkspaceStore } from '@/stores/workspace'
import { StarRating } from './StarRating'
import { ContextMenuPortal, MenuItem, MenuSeparator } from './ContextMenuPortal'
import { AiMediaSubMenu } from './AiContextMenu'
import { toast } from '@/hooks/use-toast'
import { ToastAction } from '@/components/ui/toast'
import { MediaDetailDialog } from './MediaDetailDialog'
import { cn } from '@/lib/utils'
import { VideoPlayer, type VideoPlayerHandle } from './video/VideoPlayer'
import { isTouch } from '@/hooks/useDevice'
import { useTouchArbiter, claimGesture, resetArbiter } from './video/hooks/useTouchArbiter'
import { useOrientationMode } from './video/hooks/useOrientationMode'
import { useImageZoom } from '@/hooks/useImageZoom'

interface LightBoxProps {
  onShowInExplorer?: (item: MediaItem) => void
  onMoveToAlbum?: (item: MediaItem) => void
  onSetCover?: (item: MediaItem, type: 'album' | 'person') => void
  onAiAction?: (category: string, media: MediaItem) => void
}

export function LightBox({ onShowInExplorer, onMoveToAlbum, onAiAction }: LightBoxProps) {
  const {
    lightboxIndex, lightboxItems, lightboxContext,
    closeLightbox, lightboxNext, lightboxPrev, updateMedia, softDelete,
  } = useMediaStore()

  const isOpen = lightboxIndex !== null
  const item = isOpen ? lightboxItems[lightboxIndex] : null

  const stripRef = useRef<HTMLDivElement>(null)
  const thumbRefs = useRef<(HTMLDivElement | null)[]>([])
  const [overlayVisible, setOverlayVisible] = useState(true)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  // Immersive mode
  const [immersive, setImmersive] = useState(false)
  const [mobileRatingPopup, setMobileRatingPopup] = useState(false)
  const mobileRatingTimer = useRef<ReturnType<typeof setTimeout>>()

  // Zoom refs (new: useImageZoom hook manages all zoom state via refs)
  const mainImgRef = useRef<HTMLImageElement>(null)
  const imgContainerRef = useRef<HTMLDivElement>(null)

  // Generation chain panel
  const [chainPanelOpen, setChainPanelOpen] = useState(false)
  const [chainTree, setChainTree] = useState<any>(null)
  const [chainLoading, setChainLoading] = useState(false)
  const [chainViewMode, setChainViewMode] = useState<'simple' | 'detailed'>('simple')
  const [detailOpen, setDetailOpen] = useState(false)

  // Video: session mute memory (once user unmutes, subsequent videos start unmuted)
  const [sessionUnmuted, setSessionUnmuted] = useState(false)
  const [videoMuted, setVideoMuted] = useState(!sessionUnmuted)
  const videoPlayerRef = useRef<VideoPlayerHandle>(null)

  // Landscape mode (for video fullscreen on mobile)
  const { isLandscape, setIsLandscape, toggleLandscape } = useOrientationMode()

  // Touch arbiter (shared with VideoPlayer for gesture coordination)
  const arbiterRef = useTouchArbiter()

  const isVideo = item?.media_type === 'video'

  // Image zoom hook (ref-based, 60fps direct DOM manipulation)
  const zoom = useImageZoom({
    containerRef: imgContainerRef,
    imgRef: mainImgRef,
    enabled: isOpen && !isVideo,
    onZoomChange: () => {},
  })

  // Touch swipe state
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const touchStartTime = useRef(0)
  const touchDeltaX = useRef(0)
  const swiping = useRef(false)
  const twoFingerTapped = useRef(false)

  // Browser back button support: push history state when LightBox opens,
  // close on popstate (mobile back button / edge-swipe back gesture).
  // Note: Chrome Android's edge-swipe gesture animation is OS-level and cannot
  // be suppressed by web code. This ensures correct behavior (closes lightbox
  // instead of navigating away).
  useEffect(() => {
    if (!isOpen) return

    history.pushState({ lightbox: true }, '')

    const onPopState = () => { closeLightbox() }
    window.addEventListener('popstate', onPopState)

    // Prevent overscroll-triggered navigation on some browsers
    document.documentElement.style.overscrollBehaviorX = 'none'

    return () => {
      window.removeEventListener('popstate', onPopState)
      document.documentElement.style.overscrollBehaviorX = ''
      if (history.state?.lightbox) {
        history.back()
      }
    }
  }, [isOpen, closeLightbox])

  // Preload adjacent media (images + videos)
  useEffect(() => {
    if (lightboxIndex === null || lightboxItems.length === 0) return
    const preloadLinks: HTMLLinkElement[] = []
    const preload = (idx: number) => {
      if (idx < 0 || idx >= lightboxItems.length) return
      const m = lightboxItems[idx]
      if (m.media_type === 'image') {
        const img = new Image()
        img.src = mediaApi.serveUrl(m.file_path)
      } else if (m.media_type === 'video') {
        // Use link preload to hint browser to fetch video early
        const link = document.createElement('link')
        link.rel = 'preload'
        link.as = 'video'
        link.href = mediaApi.serveUrl(m.file_path)
        document.head.appendChild(link)
        preloadLinks.push(link)
      }
    }
    preload(lightboxIndex - 1)
    preload(lightboxIndex + 1)
    preload(lightboxIndex + 2)
    return () => { preloadLinks.forEach(l => l.remove()) }
  }, [lightboxIndex, lightboxItems])

  // Auto-scroll thumbnail strip
  useEffect(() => {
    if (lightboxIndex === null || !stripRef.current) return
    const thumb = thumbRefs.current[lightboxIndex]
    if (!thumb) return
    const strip = stripRef.current
    const targetLeft = thumb.offsetLeft - strip.clientWidth / 2 + thumb.offsetWidth / 2
    strip.scrollTo({ left: targetLeft, behavior: 'smooth' })
  }, [lightboxIndex])

  // Reset zoom when image changes (hook handles internally via enabled toggle,
  // but we also reset on index change)
  useEffect(() => {
    zoom.resetZoom()
  }, [lightboxIndex])

  const handleKey = useCallback((e: KeyboardEvent) => {
    if (!isOpen) return

    if (e.key === 'Escape') {
      if (zoom.isZoomed) {
        zoom.resetZoom()
        return
      }
      if (isLandscape) {
        setIsLandscape(false)
        return
      }
      if (immersive) {
        setImmersive(false)
        document.exitFullscreen?.().catch(() => {})
        return
      }
      closeLightbox()
      return
    }

    // When viewing video, arrow keys / space / F are handled by VideoPlayer
    if (isVideo) {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'f', 'F'].includes(e.key)) return
    }

    if (e.key === 'ArrowRight') lightboxNext()
    if (e.key === 'ArrowLeft') lightboxPrev()
    if (e.key >= '1' && e.key <= '5' && item) {
      updateMedia(item.id, { rating: parseInt(e.key) })
      if (immersive && isTouch) {
        setMobileRatingPopup(true)
        clearTimeout(mobileRatingTimer.current)
        mobileRatingTimer.current = setTimeout(() => setMobileRatingPopup(false), 2000)
      }
    }
    if (e.key === '0' && item) {
      updateMedia(item.id, { rating: null })
    }
  }, [isOpen, item, isVideo, closeLightbox, lightboxNext, lightboxPrev, updateMedia, immersive, zoom, isLandscape])

  useEffect(() => {
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [handleKey])

  // Mouse wheel navigation (image area wheel is intercepted by useImageZoom hook)
  const wheelTimeout = useRef<ReturnType<typeof setTimeout>>()
  const handleWheel = useCallback((e: WheelEvent) => {
    if (!isOpen) return
    e.preventDefault()

    // If zoomed, don't switch images (wheel on black area while zoomed should still switch)
    // The hook's stopPropagation prevents this from firing for image-area wheel events.
    if (wheelTimeout.current) return
    if (e.deltaY > 0) lightboxNext()
    else if (e.deltaY < 0) lightboxPrev()
    wheelTimeout.current = setTimeout(() => { wheelTimeout.current = undefined }, 200)
  }, [isOpen, lightboxNext, lightboxPrev])

  useEffect(() => {
    if (!isOpen) return
    document.addEventListener('wheel', handleWheel, { passive: false })
    return () => document.removeEventListener('wheel', handleWheel)
  }, [isOpen, handleWheel])

  // Lock body scroll
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      setOverlayVisible(true)
      setImmersive(false)
      setIsLandscape(false)
      return () => { document.body.style.overflow = '' }
    }
  }, [isOpen])

  // Reset landscape when switching to non-video
  useEffect(() => {
    if (!isVideo) setIsLandscape(false)
  }, [isVideo])

  // Fullscreen change handler
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement && immersive) {
        setImmersive(false)
      }
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [immersive])

  // Touch handlers (arbiter-aware for video gesture coordination)
  // Note: image pinch/pan is handled by useImageZoom hook on imgContainerRef
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // Two-finger: context menu for video, images handled by hook
    if (e.touches.length >= 2) {
      if (isVideo) {
        twoFingerTapped.current = true
        resetArbiter(arbiterRef.current)
      } else {
        twoFingerTapped.current = false
      }
      swiping.current = false
      return
    }

    twoFingerTapped.current = false
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    touchStartTime.current = Date.now()
    touchDeltaX.current = 0
    swiping.current = false

    // For video: set arbiter to pending so VideoGestureLayer can compete
    if (isVideo) {
      arbiterRef.current.gesture = 'pending'
      arbiterRef.current.startTime = Date.now()
    }
  }, [isVideo])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    // Image pinch/pan handled by useImageZoom hook — skip swipe logic when zoomed
    if (!isVideo && zoom.isZoomed) return

    // If arbiter is owned by another gesture (seeking, speed_control), bail out
    if (isVideo) {
      const g = arbiterRef.current.gesture
      if (g === 'seeking' || g === 'speed_control') return
    }

    const dx = e.touches[0].clientX - touchStartX.current
    const dy = e.touches[0].clientY - touchStartY.current
    if (!swiping.current && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
      if (isVideo) {
        if (!claimGesture(arbiterRef.current, 'swiping')) return
      }
      swiping.current = true
    }
    if (swiping.current) {
      touchDeltaX.current = dx
      e.preventDefault()
    }
  }, [isVideo, zoom.isZoomed])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    // Two-finger tap → open context menu (video only)
    if (twoFingerTapped.current) {
      twoFingerTapped.current = false
      const x = touchStartX.current || 0
      const y = touchStartY.current || 0
      setContextMenu({ x, y })
      return
    }

    // Skip swipe processing when image is zoomed (hook handles touch)
    if (!isVideo && zoom.isZoomed) return

    if (swiping.current) {
      const elapsed = Date.now() - touchStartTime.current
      const absDx = Math.abs(touchDeltaX.current)
      const velocity = elapsed > 0 ? absDx / elapsed : 0 // px/ms

      // Trigger navigation: velocity-based (fast flick) OR distance-based (slow drag)
      const velocityOk = velocity > 0.3 && absDx > 20
      const distanceOk = absDx > 60

      if (velocityOk || distanceOk) {
        if (touchDeltaX.current < 0) lightboxNext()
        else lightboxPrev()
      }
    }
    swiping.current = false
    touchDeltaX.current = 0

    // Reset arbiter if we owned swiping
    if (isVideo && arbiterRef.current.gesture === 'swiping') {
      resetArbiter(arbiterRef.current)
    }
  }, [lightboxNext, lightboxPrev, isVideo, zoom.isZoomed])

  // Double-tap for mobile immersive rating popup
  const lastTapRef = useRef(0)
  const handleImageTap = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (isTouch) {
      if (immersive) {
        const now = Date.now()
        if (now - lastTapRef.current < 300) {
          // double tap → show rating popup
          setMobileRatingPopup(true)
          clearTimeout(mobileRatingTimer.current)
          mobileRatingTimer.current = setTimeout(() => setMobileRatingPopup(false), 2000)
        }
        lastTapRef.current = now
        return
      }
      setOverlayVisible((v) => !v)
      return
    }
    // PC: click/drag handled by useImageZoom hook — no action needed here
  }, [immersive])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    // When zoomed, right-click is handled by the hook (exits zoom). Don't open menu.
    if (zoom.isZoomed) return

    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [zoom.isZoomed])

  const { updateAlbum } = useAlbumStore()
  const { updatePerson } = usePersonStore()

  const handleSetAlbumCover = useCallback(async () => {
    if (!item || !lightboxContext.albumId) return
    setContextMenu(null)
    try {
      await updateAlbum(lightboxContext.albumId, { cover_media_id: item.id })
      toast({ title: '已设为图集封面' })
      lightboxContext.onCoverSet?.()
    } catch {
      toast({ title: '设置封面失败', variant: 'destructive' })
    }
  }, [item, lightboxContext, updateAlbum])

  const handleSetPersonCover = useCallback(async () => {
    if (!item || !lightboxContext.personId) return
    setContextMenu(null)
    try {
      await updatePerson(lightboxContext.personId, { cover_media_id: item.id })
      toast({ title: '已设为人物封面' })
      lightboxContext.onCoverSet?.()
    } catch {
      toast({ title: '设置封面失败', variant: 'destructive' })
    }
  }, [item, lightboxContext, updatePerson])

  const handleDelete = useCallback(async () => {
    if (!item) return
    setContextMenu(null)
    if (confirm('确定要删除这张图片吗？')) {
      await softDelete(item.id)
    }
  }, [item, softDelete])

  const handleQuickRate = useCallback(async (rating: number) => {
    if (!item) return
    setContextMenu(null)
    await updateMedia(item.id, { rating })
  }, [item, updateMedia])

  const toggleImmersive = useCallback(() => {
    if (immersive) {
      setImmersive(false)
      document.exitFullscreen?.().catch(() => {})
    } else {
      setImmersive(true)
      document.documentElement.requestFullscreen?.().catch(() => {})
    }
  }, [immersive])

  // Load generation chain tree (backend walks up to root automatically)
  const loadChainTree = useCallback(async () => {
    if (!item) return
    setChainLoading(true)
    try {
      const tree = await mediaApi.getTree(item.id)
      setChainTree(tree.root)
    } catch {
      setChainTree(null)
    }
    setChainLoading(false)
  }, [item])

  useEffect(() => {
    if (chainPanelOpen && item) loadChainTree()
  }, [chainPanelOpen, item?.id])

  const handleDetach = useCallback(async () => {
    if (!item) return
    setContextMenu(null)
    try {
      const updated = await mediaApi.detach(item.id)
      // Update in store
      useMediaStore.setState((s) => ({
        items: s.items.map(x => x.id === item.id ? updated : x),
        looseItems: s.looseItems.map(x => x.id === item.id ? updated : x),
        lightboxItems: s.lightboxItems.map(x => x.id === item.id ? updated : x),
      }))
      toast({ title: '已脱离生成链' })
      if (chainPanelOpen) loadChainTree()
    } catch {
      toast({ title: '脱离失败', variant: 'destructive' })
    }
  }, [item, chainPanelOpen, loadChainTree])

  const handleVideoScreenshot = useCallback(async (blob: Blob) => {
    if (!item) return
    try {
      const screenshotMedia = await mediaApi.captureScreenshot(item.id, blob)
      toast({
        title: '截图已保存',
        action: onAiAction && screenshotMedia
          ? <ToastAction altText="高清放大" onClick={() => onAiAction('upscale', screenshotMedia)}>高清放大</ToastAction>
          : undefined,
      })
    } catch {
      toast({ title: '截图失败', variant: 'destructive' })
    }
  }, [item, onAiAction])

  if (!isOpen || !item) return null

  const showOverlay = overlayVisible && !immersive && !isLandscape

  return createPortal(
    <div
      data-testid="lightbox"
      className="fixed inset-0 z-50 bg-black flex flex-col select-none touch-none"
      onClick={() => { if (!zoom.isZoomed) closeLightbox() }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Top bar */}
      <div
        className={cn(
          'flex items-center justify-between px-4 border-b border-white/10 shrink-0 transition-all duration-200',
          showOverlay ? 'h-14 opacity-100' : 'h-0 opacity-0 pointer-events-none overflow-hidden'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm text-white/60">
          {lightboxIndex! + 1} / {lightboxItems.length}
        </div>

        <StarRating
          value={item.rating}
          size="md"
          onChange={(r) => updateMedia(item.id, { rating: r })}
        />

        <div className="flex items-center gap-1">
          {/* Delete */}
          <button
            onClick={handleDelete}
            className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
            title="删除"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          {/* Move to album */}
          {onMoveToAlbum && (
            <button
              onClick={() => { if (item) onMoveToAlbum(item) }}
              className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
              title="移动到图集"
            >
              <FolderInput className="w-4 h-4" />
            </button>
          )}

          {/* Set cover dropdown */}
          {(lightboxContext.albumId || lightboxContext.personId) && (
            <button
              onClick={() => {
                if (lightboxContext.albumId) handleSetAlbumCover()
                else if (lightboxContext.personId) handleSetPersonCover()
              }}
              className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
              title="设为封面"
            >
              <ImageIcon className="w-4 h-4" />
            </button>
          )}

          {/* Show in explorer */}
          {onShowInExplorer && (
            <button
              onClick={() => { if (item) onShowInExplorer(item) }}
              className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
              title="在资源管理器中显示"
            >
              <FolderOpen className="w-4 h-4" />
            </button>
          )}

          {/* Explore/shuffle button */}
          {lightboxContext.exploreMode && lightboxContext.onReshuffle && (
            <button
              onClick={() => lightboxContext.onReshuffle?.()}
              className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
              title="重新洗牌"
            >
              <Shuffle className="w-4 h-4" />
            </button>
          )}

          {/* Immersive mode */}
          <button
            onClick={toggleImmersive}
            className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
            title="沉浸模式"
          >
            <Maximize className="w-4 h-4" />
          </button>

          {/* Close */}
          <button
            onClick={closeLightbox}
            className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main content */}
      <div
        className="flex-1 flex items-center justify-center relative overflow-hidden"
        onClick={(e) => { if (!zoom.isZoomed) { e.stopPropagation(); closeLightbox() } }}
        onContextMenu={handleContextMenu}
      >
        {/* Left nav strip */}
        {lightboxIndex !== 0 && !isTouch && (
          <div
            className="absolute left-0 top-0 bottom-0 w-28 z-10 hidden sm:flex items-center justify-center group/nav"
            style={{ cursor: `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\' viewBox=\'0 0 24 24\'><path d=\'M15 4l-8 8 8 8\' stroke=\'white\' stroke-width=\'2.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\' fill=\'none\'/><path d=\'M15 4l-8 8 8 8\' stroke=\'black\' stroke-width=\'0.8\' stroke-linecap=\'round\' stroke-linejoin=\'round\' fill=\'none\' opacity=\'0.3\'/></svg>')}") 12 12, pointer` }}
            onClick={(e) => { e.stopPropagation(); lightboxPrev() }}
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
              onMutedChange={(m) => {
                setVideoMuted(m)
                if (!m) setSessionUnmuted(true)
              }}
              onScreenshot={handleVideoScreenshot}
              isLandscape={isLandscape}
              onLandscapeChange={(_: boolean) => toggleLandscape()}
              touchArbiter={arbiterRef}
          />
        ) : (
          <div
            ref={imgContainerRef}
            className="absolute inset-0 overflow-hidden"
            onClick={(e) => {
              // Only intercept clicks on the image itself; clicks on black borders
              // should bubble up to the outer container to close the lightbox
              const rect = e.currentTarget.getBoundingClientRect()
              const cx = e.clientX - rect.left
              const cy = e.clientY - rect.top
              if (!zoom.isZoomed && !zoom.isPointOnImage(cx, cy)) return
              e.stopPropagation()
              // Mobile: toggle overlay / immersive rating
              if (isTouch) handleImageTap(e)
            }}
          >
            <img
              ref={mainImgRef}
              src={mediaApi.serveUrl(item.file_path)}
              alt=""
              className="select-none"
              draggable={false}
            />
            {/* Zoom level indicator */}
            <div
              data-zoom-indicator
              className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/60 text-white/70 text-xs px-3 py-1 rounded-full pointer-events-none transition-opacity duration-200"
              style={{ opacity: 0 }}
            />
          </div>
        )}

        {/* Right nav strip */}
        {lightboxIndex !== lightboxItems.length - 1 && !isTouch && (
          <div
            className="absolute right-0 top-0 bottom-0 w-28 z-10 hidden sm:flex items-center justify-center group/nav"
            style={{ cursor: `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\' viewBox=\'0 0 24 24\'><path d=\'M9 4l8 8-8 8\' stroke=\'white\' stroke-width=\'2.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\' fill=\'none\'/><path d=\'M9 4l8 8-8 8\' stroke=\'black\' stroke-width=\'0.8\' stroke-linecap=\'round\' stroke-linejoin=\'round\' fill=\'none\' opacity=\'0.3\'/></svg>')}") 12 12, pointer` }}
            onClick={(e) => { e.stopPropagation(); lightboxNext() }}
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

      {/* Generation chain panel */}
      {chainPanelOpen && (
        <div
          className="absolute right-0 top-14 bottom-20 w-72 bg-black/80 border-l border-white/10 overflow-auto z-20 p-4"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white/80">生成链</h3>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setChainViewMode(v => v === 'simple' ? 'detailed' : 'simple')}
                className="text-xs px-1.5 py-0.5 rounded bg-white/10 text-white/60 hover:text-white transition-colors"
              >
                {chainViewMode === 'simple' ? '详细' : '简略'}
              </button>
              <button onClick={() => setChainPanelOpen(false)} className="text-white/40 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          {chainLoading ? (
            <p className="text-xs text-white/40">加载中...</p>
          ) : chainTree ? (
            <ChainNode node={chainTree} currentId={item?.id} viewMode={chainViewMode} onNavigate={async (id: string) => {
              // Use getState() for fresh values, not stale closure
              const current = useMediaStore.getState().lightboxItems
              const idx = current.findIndex(m => m.id === id)
              if (idx >= 0) {
                useMediaStore.setState({ lightboxIndex: idx })
              } else {
                // Target not in current list — fetch and append
                try {
                  const m = await mediaApi.get(id)
                  const fresh = useMediaStore.getState().lightboxItems
                  useMediaStore.setState({ lightboxItems: [...fresh, m], lightboxIndex: fresh.length })
                } catch (e) {
                  console.error('Chain navigate failed:', e)
                }
              }
            }} />
          ) : (
            <p className="text-xs text-white/40">无生成链数据</p>
          )}
        </div>
      )}

      {/* Thumbnail strip (hidden in landscape mode) */}
      {lightboxItems.length > 1 && !isLandscape && (
        <div
          ref={stripRef}
          className={cn(
            'h-20 border-t border-white/10 flex items-center gap-1 overflow-x-auto shrink-0 scroll-smooth transition-opacity duration-200',
            showOverlay ? 'opacity-100' : 'opacity-0 pointer-events-none'
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="shrink-0" style={{ width: 'calc(50vw - 34px)' }} />
          {lightboxItems.map((m, i) => (
            <div
              key={m.id}
              ref={(el) => { thumbRefs.current[i] = el }}
              className={cn(
                'h-16 w-16 shrink-0 cursor-pointer rounded overflow-hidden border-2 transition-all',
                i === lightboxIndex
                  ? 'border-primary opacity-100'
                  : 'border-transparent opacity-30 hover:opacity-60'
              )}
              onClick={() => useMediaStore.setState({ lightboxIndex: i })}
            >
              <img
                src={mediaApi.itemThumbUrl(m, 80)}
                alt=""
                className="w-full h-full object-cover"
              />
            </div>
          ))}
          <div className="shrink-0" style={{ width: 'calc(50vw - 34px)' }} />
        </div>
      )}

      {/* Immersive exit hint */}
      {immersive && (
        <div className="fixed top-4 right-4 z-[60]">
          <button
            onClick={toggleImmersive}
            className="p-2 rounded-full bg-black/40 hover:bg-black/60 text-white/40 hover:text-white transition-all opacity-0 hover:opacity-100"
          >
            <Minimize className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <ContextMenuPortal position={contextMenu} onClose={() => setContextMenu(null)}>
          {immersive ? (
            <MenuItem icon={<Minimize className="w-3.5 h-3.5" />} label="退出沉浸模式" onClick={() => { setContextMenu(null); toggleImmersive() }} />
          ) : (
            <>
              {lightboxContext.albumId && (
                <MenuItem icon={<ImageIcon className="w-3.5 h-3.5" />} label="设为图集封面" onClick={handleSetAlbumCover} />
              )}
              {lightboxContext.personId && (
                <MenuItem icon={<ImageIcon className="w-3.5 h-3.5" />} label="设为人物封面" onClick={handleSetPersonCover} />
              )}
              {onAiAction && item && (
                <AiMediaSubMenu
                  item={item}
                  onAction={(cat) => { setContextMenu(null); onAiAction(cat, item!) }}
                />
              )}
              {isVideo && (
                <MenuItem
                  icon={videoMuted ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                  label={videoMuted ? '取消静音' : '静音'}
                  onClick={() => { setContextMenu(null); videoPlayerRef.current?.toggleMute() }}
                />
              )}
              {item && (
                <MenuItem icon={<Briefcase className="w-3.5 h-3.5" />} label="加入工作区" onClick={async () => {
                  setContextMenu(null)
                  try {
                    await useWorkspaceStore.getState().addItem(item!.id)
                    toast({ title: '已加入工作区' })
                  } catch (err: any) {
                    toast({ title: err.message || '添加失败', variant: 'destructive' })
                  }
                }} />
              )}
              {onMoveToAlbum && item && (
                <MenuItem icon={<FolderInput className="w-3.5 h-3.5" />} label="移动到图集" onClick={() => { setContextMenu(null); onMoveToAlbum(item!) }} />
              )}
              {onShowInExplorer && item && (
                <MenuItem icon={<FolderOpen className="w-3.5 h-3.5" />} label="在资源管理器中显示" onClick={() => { setContextMenu(null); onShowInExplorer(item!) }} />
              )}
              {item && (
                <MenuItem icon={<GitBranch className="w-3.5 h-3.5" />} label="生成链" onClick={() => { setContextMenu(null); setChainPanelOpen(v => !v) }} />
              )}
              {item && item.parent_media_id && (
                <MenuItem icon={<Unlink className="w-3.5 h-3.5" />} label="脱离生成链" onClick={handleDetach} />
              )}

              <div className="px-3 py-1.5 flex items-center gap-1">
                <Star className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-muted-foreground text-xs mr-1">评分</span>
                {[1, 2, 3, 4, 5].map((r) => (
                  <button
                    key={r}
                    className={cn(
                      'w-5 h-5 rounded text-xs font-medium transition-colors',
                      item?.rating === r ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                    )}
                    onClick={() => handleQuickRate(r)}
                  >
                    {r}
                  </button>
                ))}
              </div>

              <MenuSeparator />

              {item && <MenuItem icon={<Info className="w-3.5 h-3.5" />} label="查看详情" onClick={() => { setContextMenu(null); setDetailOpen(true) }} />}
              <MenuItem icon={<Trash2 className="w-3.5 h-3.5" />} label="删除" onClick={handleDelete} destructive />
            </>
          )}
        </ContextMenuPortal>
      )}

      <MediaDetailDialog open={detailOpen} onOpenChange={setDetailOpen} item={item} />
    </div>,
    document.body
  )
}

const WORKFLOW_COLORS: Record<string, string> = {
  upscale: 'border-blue-400',
  face_swap: 'border-purple-400',
  inpaint_flux: 'border-amber-400',
  inpaint_sdxl: 'border-amber-400',
  inpaint_klein: 'border-amber-400',
  screenshot: 'border-green-400',
  local: 'border-gray-400',
  generated: 'border-cyan-400',
}

function ChainNode({ node, currentId, onNavigate, viewMode = 'simple', depth = 0 }: {
  node: any
  currentId?: string
  onNavigate: (id: string) => void
  viewMode?: 'simple' | 'detailed'
  depth?: number
}) {
  if (!node || !node.id) return null
  const isCurrent = node.id === currentId
  const colorClass = WORKFLOW_COLORS[node.workflow_type || node.source_type] || 'border-gray-500'

  if (viewMode === 'detailed') {
    const params = node.generation_params
    const paramsSummary = params
      ? Object.entries(params).slice(0, 3).map(([k, v]) => `${k}: ${String(v).slice(0, 20)}`).join(', ')
      : null
    return (
      <div style={{ marginLeft: depth * 8 }} className={cn('border-l-2 pl-2 mb-1', colorClass)}>
        <button
          className={cn(
            'flex items-center gap-2 w-full text-left px-2 py-1.5 rounded text-xs transition-colors',
            isCurrent ? 'bg-primary/30 text-white' : 'text-white/60 hover:bg-white/10 hover:text-white'
          )}
          onClick={() => onNavigate(node.id)}
        >
          <img
            src={mediaApi.thumbUrl(node.file_path, 40)}
            className="w-10 h-10 rounded object-cover shrink-0"
            alt=""
          />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{node.workflow_type || node.source_type}</div>
            {node.rating && <span className="text-yellow-400 text-[10px]">{'\u2605'.repeat(node.rating)}</span>}
            {paramsSummary && <div className="text-[10px] text-white/40 truncate mt-0.5">{paramsSummary}</div>}
          </div>
        </button>
        {node.children?.map((c: any) => (
          <ChainNode key={c.id} node={c} currentId={currentId} onNavigate={onNavigate} viewMode={viewMode} depth={depth + 1} />
        ))}
      </div>
    )
  }

  return (
    <div style={{ marginLeft: depth * 12 }}>
      <button
        className={cn(
          'flex items-center gap-2 w-full text-left px-2 py-1 rounded text-xs transition-colors',
          isCurrent ? 'bg-primary/30 text-white' : 'text-white/60 hover:bg-white/10 hover:text-white'
        )}
        onClick={() => onNavigate(node.id)}
      >
        <img
          src={mediaApi.thumbUrl(node.file_path, 40)}
          className="w-8 h-8 rounded object-cover shrink-0"
          alt=""
        />
        <div className="min-w-0">
          <div className="truncate">{node.workflow_type || node.source_type}</div>
          {node.rating && <span className="text-yellow-400">{'\u2605'.repeat(node.rating)}</span>}
        </div>
      </button>
      {node.children?.map((c: any) => (
        <ChainNode key={c.id} node={c} currentId={currentId} onNavigate={onNavigate} viewMode={viewMode} depth={depth + 1} />
      ))}
    </div>
  )
}
