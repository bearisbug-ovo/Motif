import { useEffect, useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Minimize } from 'lucide-react'
import { mediaApi, MediaItem } from '@/api/media'
import { systemApi } from '@/api/system'
import { useLightboxStore } from '@/stores/lightbox'
import { useMediaStore } from '@/stores/media'
import { toast } from '@/hooks/use-toast'
import { confirmAndDelete } from '@/lib/deleteMedia'
import { ToastAction } from '@/components/ui/toast'
import { MediaDetailDialog } from '../MediaDetailDialog'
import { CropEditor } from '../CropEditor'
import { VideoTrimEditor } from '../VideoTrimEditor'
import { cn } from '@/lib/utils'
import { isTouch } from '@/hooks/useDevice'
import type { VideoPlayerHandle } from '../video/VideoPlayer'
import { useTouchArbiter } from '../video/hooks/useTouchArbiter'
import { useOrientationMode } from '../video/hooks/useOrientationMode'
import { useImageZoom } from '@/hooks/useImageZoom'

import { LightBoxTopBar } from './LightBoxTopBar'
import { LightBoxMedia } from './LightBoxMedia'
import { LightBoxContextMenu } from './LightBoxContextMenu'
import { ChainIndicator } from './ChainIndicator'
import { SourceButtons } from './SourceButtons'
import { ThumbnailStrip } from './ThumbnailStrip'
import { useLightboxInput } from './hooks/useLightboxInput'

interface LightBoxProps {
  onShowInExplorer?: (item: MediaItem) => void
  onMoveToAlbum?: (item: MediaItem) => void
  onMoveToPerson?: (item: MediaItem) => void
  onSetCover?: (item: MediaItem, type: 'album' | 'person') => void
  onAiAction?: (category: string, media: MediaItem) => void
}

export function LightBox({ onShowInExplorer, onMoveToAlbum, onMoveToPerson, onAiAction }: LightBoxProps) {
  const { isOpen, currentItem: item, context, close } = useLightboxStore()
  const { softDelete } = useMediaStore()

  const [overlayVisible, setOverlayVisible] = useState(true)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [immersive, setImmersive] = useState(false)
  const [mobileRatingPopup, setMobileRatingPopup] = useState(false)
  const mobileRatingTimer = useRef<ReturnType<typeof setTimeout>>()
  const [detailOpen, setDetailOpen] = useState(false)
  const [cropOpen, setCropOpen] = useState(false)
  const [trimOpen, setTrimOpen] = useState(false)
  const [sessionUnmuted, setSessionUnmuted] = useState(false)
  const [videoMuted, setVideoMuted] = useState(true)

  const videoPlayerRef = useRef<VideoPlayerHandle>(null)
  const mainImgRef = useRef<HTMLImageElement>(null)
  const imgContainerRef = useRef<HTMLDivElement>(null)

  const { isLandscape, setIsLandscape, toggleLandscape } = useOrientationMode()
  const arbiterRef = useTouchArbiter()

  const isVideo = item?.media_type === 'video'

  const zoom = useImageZoom({
    containerRef: imgContainerRef,
    imgRef: mainImgRef,
    enabled: isOpen && !isVideo,
    onZoomChange: () => {},
  })

  const editorOpen = cropOpen || trimOpen

  // Input handling (keyboard, wheel, touch)
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useLightboxInput({
    isVideo: !!isVideo,
    isLandscape,
    immersive,
    zoom,
    setOverlayVisible,
    setIsLandscape,
    setImmersive,
    setContextMenu,
    setMobileRatingPopup,
    mobileRatingTimer,
    arbiterRef,
    disabled: editorOpen,
  })

  // Browser back button support
  useEffect(() => {
    if (!isOpen) return
    history.pushState({ lightbox: true }, '')
    const onPopState = () => { close() }
    window.addEventListener('popstate', onPopState)
    document.documentElement.style.overscrollBehaviorX = 'none'
    return () => {
      window.removeEventListener('popstate', onPopState)
      document.documentElement.style.overscrollBehaviorX = ''
      if (history.state?.lightbox) history.back()
    }
  }, [isOpen, close])

  // Preload adjacent media (±5 images, closest first)
  useEffect(() => {
    if (!isOpen) return
    const { localItems, localIndex } = useLightboxStore.getState()
    if (localItems.length === 0) return
    const preloadLinks: HTMLLinkElement[] = []
    const preload = (idx: number) => {
      if (idx < 0 || idx >= localItems.length) return
      const m = localItems[idx]
      if (m.media_type === 'image') {
        const img = new Image()
        img.src = mediaApi.serveUrl(m.file_path)
      } else if (m.media_type === 'video') {
        const link = document.createElement('link')
        link.rel = 'preload'
        link.as = 'video'
        link.href = mediaApi.serveUrl(m.file_path)
        document.head.appendChild(link)
        preloadLinks.push(link)
      }
    }
    // Priority order: nearest first, forward-biased
    for (const offset of [1, -1, 2, -2, 3, -3, 4, 5]) {
      preload(localIndex + offset)
    }
    return () => { preloadLinks.forEach(l => l.remove()) }
  }, [isOpen, item?.id])

  // Zoom is preserved across image changes by useImageZoom's onImgLoad handler.
  // No need to explicitly reset here.

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
      if (!document.fullscreenElement && immersive) setImmersive(false)
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [immersive])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (zoom.isZoomed) return
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [zoom.isZoomed])

  const handleDelete = useCallback(async () => {
    if (!item) return
    setContextMenu(null)
    await confirmAndDelete(item.id, softDelete)
  }, [item, softDelete])

  const toggleImmersive = useCallback(() => {
    if (immersive) {
      setImmersive(false)
      document.exitFullscreen?.().catch(() => {})
    } else {
      setImmersive(true)
      document.documentElement.requestFullscreen?.().catch(() => {})
    }
  }, [immersive])

  const handleRelocate = useCallback(async () => {
    if (!item) return
    try {
      const { paths } = await systemApi.pickFiles()
      if (paths.length === 0) return
      const updated = await mediaApi.relocate(item.id, paths[0])
      useMediaStore.getState().replaceItem(updated)
      toast({ title: '文件已重新定位' })
    } catch (err: any) {
      toast({ title: '重新定位失败', description: err.message, variant: 'destructive' })
    }
  }, [item])

  const handleVideoScreenshot = useCallback(async (blob: Blob, timestamp: number) => {
    if (!item) return
    try {
      const screenshotMedia = await mediaApi.captureScreenshot(item.id, blob, timestamp)
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

  const handleCropComplete = useCallback(async (blob: Blob, options: import('../CropEditor').CropSaveOptions) => {
    if (!item) return
    setCropOpen(false)
    try {
      const result = await mediaApi.cropMedia(item.id, blob, {
        overwrite: options.overwrite,
        personId: options.personId,
        albumId: options.albumId,
        linkParent: options.linkParent,
      })
      if (options.overwrite) {
        useMediaStore.getState().replaceItem(result)
        useLightboxStore.setState((s) => ({
          currentItem: s.currentItem?.id === result.id ? result : s.currentItem,
          localItems: s.localItems.map(x => x.id === result.id ? result : x),
        }))
        useLightboxStore.getState().invalidateChainCache()
        toast({ title: '裁剪已保存（覆盖原图）' })
      } else {
        useMediaStore.setState((s) => ({ items: [result, ...s.items] }))
        useLightboxStore.getState().invalidateChainCache()
        toast({ title: '裁剪已保存为新图片' })
      }
    } catch (err: any) {
      toast({ title: '裁剪失败', description: err.message, variant: 'destructive' })
    }
  }, [item])

  const handleTrimComplete = useCallback(async (start: number, end: number, options: import('../VideoTrimEditor').TrimSaveOptions) => {
    if (!item) return
    setTrimOpen(false)
    try {
      toast({ title: '正在裁剪视频...' })
      const result = await mediaApi.trimVideo(item.id, start, end, {
        precise: options.precise,
        personId: options.personId,
        albumId: options.albumId,
        linkParent: options.linkParent,
      })
      useMediaStore.setState((s) => ({ items: [result, ...s.items] }))
      useLightboxStore.getState().invalidateChainCache()
      toast({ title: '视频裁剪完成' })
    } catch (err: any) {
      toast({ title: '视频裁剪失败', description: err.message, variant: 'destructive' })
    }
  }, [item])

  if (!isOpen || !item) return null

  const showOverlay = overlayVisible && !immersive && !isLandscape

  return createPortal(
    <div
      data-testid="lightbox"
      className="fixed inset-0 z-50 bg-black flex flex-col select-none touch-none"
      onClick={() => { if (!zoom.isZoomed && !editorOpen) close() }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <LightBoxTopBar
        visible={showOverlay}
        immersive={immersive}
        onToggleImmersive={toggleImmersive}
        onDelete={handleDelete}
        onShowInExplorer={onShowInExplorer}
        onMoveToAlbum={onMoveToAlbum}
      />

      {/* Media area + floating chain indicator */}
      <div className="flex-1 flex flex-col relative min-h-0">
        <LightBoxMedia
          immersive={immersive}
          isLandscape={isLandscape}
          onToggleLandscape={toggleLandscape}
          onContextMenu={handleContextMenu}
          onClose={close}
          sessionUnmuted={sessionUnmuted}
          onSessionUnmute={() => setSessionUnmuted(true)}
          onVideoScreenshot={handleVideoScreenshot}
          touchArbiter={arbiterRef}
          videoPlayerRef={videoPlayerRef}
          imgContainerRef={imgContainerRef}
          mainImgRef={mainImgRef}
          zoom={zoom}
          mobileRatingPopup={mobileRatingPopup}
        />

        {/* Chain indicator or source buttons (task results mode) */}
        {!isLandscape && showOverlay && (
          context.taskResultsMode ? (
            <SourceButtons />
          ) : (
            <div data-chain-indicator>
              <ChainIndicator onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (!zoom.isZoomed) setContextMenu({ x: e.clientX, y: e.clientY })
              }} />
            </div>
          )
        )}
      </div>

      {/* Thumbnail strip */}
      {!isLandscape && (
        <div data-strip>
          <ThumbnailStrip visible={showOverlay} />
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

      {/* Context menu */}
      <LightBoxContextMenu
        position={contextMenu}
        onClose={() => setContextMenu(null)}
        immersive={immersive}
        onToggleImmersive={toggleImmersive}
        onDelete={handleDelete}
        onShowInExplorer={onShowInExplorer}
        onMoveToAlbum={onMoveToAlbum}
        onMoveToPerson={onMoveToPerson}
        onAiAction={onAiAction}
        videoPlayerRef={videoPlayerRef}
        videoMuted={videoMuted}
        onOpenDetail={() => setDetailOpen(true)}
        onOpenChainPanel={() => {
          // Chain panel is now the ChainIndicator (always visible when has chain)
          // Just load the chain if not loaded
          useLightboxStore.getState().loadChainForCurrent()
        }}
        onRelocate={item.source_type === 'local' ? handleRelocate : undefined}
        onCrop={() => setCropOpen(true)}
        onTrim={() => setTrimOpen(true)}
      />

      <MediaDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        item={item}
        onRelocated={(updated) => useMediaStore.getState().replaceItem(updated)}
      />

      <CropEditor
        open={cropOpen}
        onClose={() => setCropOpen(false)}
        media={item}
        mode="save"
        onComplete={handleCropComplete}
      />

      <VideoTrimEditor
        open={trimOpen}
        onClose={() => setTrimOpen(false)}
        media={item}
        onComplete={handleTrimComplete}
      />
    </div>,
    document.body
  )
}
