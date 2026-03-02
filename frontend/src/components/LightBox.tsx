import { useEffect, useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, ChevronLeft, ChevronRight, Trash2, ImageIcon, Star } from 'lucide-react'
import { mediaApi } from '@/api/media'
import { useMediaStore } from '@/stores/media'
import { useAlbumStore } from '@/stores/album'
import { usePersonStore } from '@/stores/person'
import { StarRating } from './StarRating'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

export function LightBox() {
  const { lightboxIndex, lightboxItems, lightboxContext, closeLightbox, lightboxNext, lightboxPrev, updateMedia, softDelete } = useMediaStore()

  const isOpen = lightboxIndex !== null
  const item = isOpen ? lightboxItems[lightboxIndex] : null

  const stripRef = useRef<HTMLDivElement>(null)
  const thumbRefs = useRef<(HTMLDivElement | null)[]>([])
  const [overlayVisible, setOverlayVisible] = useState(true)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  // Touch swipe state
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const touchDeltaX = useRef(0)
  const swiping = useRef(false)

  // Preload adjacent images
  useEffect(() => {
    if (lightboxIndex === null || lightboxItems.length === 0) return
    const preload = (idx: number) => {
      if (idx >= 0 && idx < lightboxItems.length) {
        const img = new Image()
        img.src = mediaApi.serveUrl(lightboxItems[idx].file_path)
      }
    }
    preload(lightboxIndex - 1)
    preload(lightboxIndex + 1)
    preload(lightboxIndex + 2)
  }, [lightboxIndex, lightboxItems])

  // Auto-scroll thumbnail strip to keep current item centered
  useEffect(() => {
    if (lightboxIndex === null || !stripRef.current) return
    const thumb = thumbRefs.current[lightboxIndex]
    if (!thumb) return
    const strip = stripRef.current
    const targetLeft = thumb.offsetLeft - strip.clientWidth / 2 + thumb.offsetWidth / 2
    strip.scrollTo({ left: targetLeft, behavior: 'smooth' })
  }, [lightboxIndex])

  const handleKey = useCallback((e: KeyboardEvent) => {
    if (!isOpen) return
    if (e.key === 'Escape') closeLightbox()
    if (e.key === 'ArrowRight') lightboxNext()
    if (e.key === 'ArrowLeft') lightboxPrev()
    if (e.key >= '1' && e.key <= '5' && item) {
      updateMedia(item.id, { rating: parseInt(e.key) })
    }
    if (e.key === '0' && item) {
      updateMedia(item.id, { rating: null })
    }
  }, [isOpen, item, closeLightbox, lightboxNext, lightboxPrev, updateMedia])

  useEffect(() => {
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [handleKey])

  // Mouse wheel navigation
  const wheelTimeout = useRef<ReturnType<typeof setTimeout>>()
  const handleWheel = useCallback((e: WheelEvent) => {
    if (!isOpen) return
    e.preventDefault()
    // Debounce to avoid rapid-fire navigation
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

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      setOverlayVisible(true)
      return () => { document.body.style.overflow = '' }
    }
  }, [isOpen])

  // Close context menu on any click
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    document.addEventListener('click', close)
    document.addEventListener('contextmenu', close)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('contextmenu', close)
    }
  }, [contextMenu])

  // Touch handlers for swipe navigation
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    touchDeltaX.current = 0
    swiping.current = false
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - touchStartX.current
    const dy = e.touches[0].clientY - touchStartY.current
    if (!swiping.current && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
      swiping.current = true
    }
    if (swiping.current) {
      touchDeltaX.current = dx
      e.preventDefault()
    }
  }, [])

  const handleTouchEnd = useCallback(() => {
    if (swiping.current) {
      const threshold = 60
      if (touchDeltaX.current < -threshold) lightboxNext()
      else if (touchDeltaX.current > threshold) lightboxPrev()
    }
    swiping.current = false
    touchDeltaX.current = 0
  }, [lightboxNext, lightboxPrev])

  const handleImageTap = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (window.matchMedia('(pointer: coarse)').matches) {
      setOverlayVisible((v) => !v)
    }
  }, [])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

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
      // softDelete already updates lightboxItems/lightboxIndex in the store
    }
  }, [item, softDelete])

  const handleQuickRate = useCallback(async (rating: number) => {
    if (!item) return
    setContextMenu(null)
    await updateMedia(item.id, { rating })
  }, [item, updateMedia])

  if (!isOpen || !item) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-black/95 flex flex-col select-none touch-none"
      onClick={closeLightbox}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Top bar */}
      <div
        className={`flex items-center justify-between px-4 h-14 border-b border-white/10 shrink-0 transition-opacity duration-200 ${
          overlayVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
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
        <button
          onClick={closeLightbox}
          className="text-white/60 hover:text-white transition-colors"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* Main image */}
      <div
        className="flex-1 flex items-center justify-center relative overflow-hidden"
        onClick={closeLightbox}
        onContextMenu={handleContextMenu}
      >
        <button
          className="absolute left-4 z-10 p-2 rounded-full bg-black/40 hover:bg-black/60 text-white transition-colors hidden sm:block"
          onClick={(e) => { e.stopPropagation(); lightboxPrev() }}
          disabled={lightboxIndex === 0}
        >
          <ChevronLeft className="w-6 h-6" />
        </button>

        <img
          src={mediaApi.serveUrl(item.file_path)}
          alt=""
          className="max-w-full max-h-full object-contain"
          onClick={handleImageTap}
          onContextMenu={handleContextMenu}
          draggable={false}
        />

        <button
          className="absolute right-4 z-10 p-2 rounded-full bg-black/40 hover:bg-black/60 text-white transition-colors hidden sm:block"
          onClick={(e) => { e.stopPropagation(); lightboxNext() }}
          disabled={lightboxIndex === lightboxItems.length - 1}
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      </div>

      {/* Thumbnail strip */}
      {lightboxItems.length > 1 && (
        <div
          ref={stripRef}
          className={`h-20 border-t border-white/10 flex items-center gap-1 overflow-x-auto shrink-0 scroll-smooth transition-opacity duration-200 ${
            overlayVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="shrink-0" style={{ width: 'calc(50vw - 34px)' }} />
          {lightboxItems.map((m, i) => (
            <div
              key={m.id}
              ref={(el) => { thumbRefs.current[i] = el }}
              className={`h-16 w-16 shrink-0 cursor-pointer rounded overflow-hidden border-2 transition-all ${
                i === lightboxIndex
                  ? 'border-primary opacity-100'
                  : 'border-transparent opacity-30 hover:opacity-60'
              }`}
              onClick={() => useMediaStore.setState({ lightboxIndex: i })}
            >
              <img
                src={mediaApi.thumbUrl(m.file_path, 80)}
                alt=""
                className="w-full h-full object-cover"
              />
            </div>
          ))}
          <div className="shrink-0" style={{ width: 'calc(50vw - 34px)' }} />
        </div>
      )}

      {/* Right-click context menu */}
      {contextMenu && createPortal(
        <div
          className="fixed z-[200] bg-popover border border-border rounded-md shadow-lg py-1 min-w-[160px] text-sm"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {lightboxContext.albumId && (
            <button
              className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-accent"
              onClick={handleSetAlbumCover}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              设为图集封面
            </button>
          )}
          {lightboxContext.personId && (
            <button
              className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-accent"
              onClick={handleSetPersonCover}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              设为人物封面
            </button>
          )}

          <div className="px-3 py-1.5 flex items-center gap-1">
            <Star className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-muted-foreground text-xs mr-1">评分</span>
            {[1, 2, 3, 4, 5].map((r) => (
              <button
                key={r}
                className={cn(
                  'w-5 h-5 rounded text-xs font-medium transition-colors',
                  item.rating === r ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                )}
                onClick={() => handleQuickRate(r)}
              >
                {r}
              </button>
            ))}
          </div>

          <div className="h-px bg-border my-1" />

          <button
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-destructive hover:bg-accent hover:text-destructive"
            onClick={handleDelete}
          >
            <Trash2 className="w-3.5 h-3.5" />
            删除
          </button>
        </div>,
        document.body
      )}
    </div>
  )
}
