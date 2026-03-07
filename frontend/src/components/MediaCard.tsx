import { useState, useCallback } from 'react'
import { Trash2, ImageIcon, Star, AlertTriangle, Info } from 'lucide-react'
import { MediaItem, mediaApi } from '@/api/media'
import { StarRating } from './StarRating'
import { ContextMenuPortal, MenuItem, MenuSeparator } from './ContextMenuPortal'
import { useMediaStore } from '@/stores/media'
import { useAlbumStore } from '@/stores/album'
import { usePersonStore } from '@/stores/person'
import { toast } from '@/hooks/use-toast'
import { MediaDetailDialog } from './MediaDetailDialog'
import { cn } from '@/lib/utils'

const BADGE_COLORS: Record<number, string> = {
  1: 'bg-slate-500/70',
  2: 'bg-sky-600/60',
  3: 'bg-purple-500/60',
  4: 'bg-amber-500/70',
  5: 'bg-pink-400/60',
}

interface MediaCardProps {
  item: MediaItem
  onClick?: () => void
  showActions?: boolean
  showRating?: boolean
  albumId?: string
  personId?: string
  onCoverSet?: () => void
  /** Multi-select mode */
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: (id: string) => void
  /** Extra context menu items injected by parent */
  extraMenuItems?: React.ReactNode
  /** Hide text overlays when cards are tiny */
  compact?: boolean
  /** File missing on disk */
  missingFile?: boolean
  /** Stagger animation index */
  animIndex?: number
}

export function MediaCard({
  item, onClick, showActions = true, showRating = true,
  albumId, personId, onCoverSet,
  selectable, selected, onToggleSelect,
  extraMenuItems, compact, missingFile, animIndex,
}: MediaCardProps) {
  const [hovered, setHovered] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [imgError, setImgError] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const { updateMedia, softDelete } = useMediaStore()
  const { updateAlbum } = useAlbumStore()
  const { updatePerson } = usePersonStore()

  const thumbUrl = mediaApi.itemThumbUrl(item, 400)
  const fileName = item.file_path.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')

  const handleRate = async (rating: number | null) => {
    await updateMedia(item.id, { rating })
  }

  const handleDelete = useCallback(async () => {
    setContextMenu(null)
    if (confirm('确定要删除这张图片吗？')) {
      await softDelete(item.id)
    }
  }, [item.id, softDelete])

  const handleSetAlbumCover = useCallback(async () => {
    setContextMenu(null)
    if (!albumId) return
    try {
      await updateAlbum(albumId, { cover_media_id: item.id })
      toast({ title: '已设为图集封面' })
      onCoverSet?.()
    } catch {
      toast({ title: '设置封面失败', variant: 'destructive' })
    }
  }, [item.id, albumId, updateAlbum, onCoverSet])

  const handleSetPersonCover = useCallback(async () => {
    setContextMenu(null)
    if (!personId) return
    try {
      await updatePerson(personId, { cover_media_id: item.id })
      toast({ title: '已设为人物封面' })
      onCoverSet?.()
    } catch {
      toast({ title: '设置封面失败', variant: 'destructive' })
    }
  }, [item.id, personId, updatePerson, onCoverSet])

  const handleQuickRate = useCallback(async (rating: number) => {
    setContextMenu(null)
    await updateMedia(item.id, { rating })
  }, [item.id, updateMedia])

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  const handleClick = () => {
    if (selectable && onToggleSelect) {
      onToggleSelect(item.id)
    } else {
      onClick?.()
    }
  }

  return (
    <>
      <div
        data-testid="media-card"
        data-media-id={item.id}
        className={cn(
          'relative group rounded-none sm:rounded-md overflow-hidden bg-card border cursor-pointer select-none transition-all duration-200 hover:shadow-lg hover:shadow-black/30 animate-fade-in-up',
          selected ? 'border-primary border-2' : 'border-border',
          imgError && 'border-dashed border-red-500/60',
          missingFile && 'border-red-500 border-2',
        )}
        style={animIndex != null ? { animationDelay: `${Math.min(animIndex * 30, 600)}ms` } : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        <div className="aspect-square overflow-hidden">
          {imgError ? (
            <div className="w-full h-full flex flex-col items-center justify-center text-red-400/80 gap-1">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <span className="text-xs">文件缺失</span>
            </div>
          ) : (
            <img
              src={thumbUrl}
              alt=""
              loading="lazy"
              className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
              onError={() => setImgError(true)}
            />
          )}
        </div>

        {/* Missing file indicator */}
        {missingFile && !imgError && (
          <div className="absolute top-1.5 right-1.5 bg-red-500 rounded-full p-0.5 z-10">
            <AlertTriangle className="w-3 h-3 text-white" />
          </div>
        )}

        {/* Select checkbox in multi-select mode */}
        {selectable && (
          <div className={cn(
            'absolute top-1.5 right-1.5 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all z-10',
            selected ? 'bg-primary border-primary' : 'border-white/60 bg-black/30',
          )}>
            {selected && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
          </div>
        )}

        {/* Rating badge */}
        {!selectable && item.rating !== null && item.rating > 0 && (
          <div className={cn(
            'absolute top-1.5 left-1.5 rounded px-1.5 py-0.5 flex items-center gap-0.5',
            BADGE_COLORS[item.rating] || 'bg-black/60'
          )}>
            <span className="text-xs text-white font-medium">★{item.rating}</span>
          </div>
        )}

        {/* Source type badge */}
        {!selectable && item.source_type !== 'local' && (
          <div className={cn(
            'absolute top-1.5 right-1.5 text-xs px-1.5 py-0.5 rounded',
            item.source_type === 'generated' ? 'bg-primary/80 text-white' : 'bg-blue-600/80 text-white'
          )}>
            {item.source_type === 'generated' ? 'AI' : '截图'}
          </div>
        )}

        {/* Video play icon — scales with card (20% of card width, min 16px, max 28px) */}
        {item.media_type === 'video' && !imgError && (
          <div className="absolute bottom-[4%] right-[4%] w-[20%] max-w-7 min-w-4 aspect-square rounded-full bg-black/60 flex items-center justify-center">
            <svg className="w-1/2 h-1/2 text-white ml-[5%]" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        )}

        {/* Filename overlay — same style as AlbumCard */}
        {!compact && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent px-2 pb-1.5 pt-6 pointer-events-none">
            <h3 className="text-white font-medium truncate text-sm">{fileName}</h3>
          </div>
        )}

        {/* Hover overlay */}
        {showActions && !selectable && (
          <div className={cn(
            'absolute inset-0 bg-black/30 transition-opacity flex flex-col justify-end p-2',
            hovered ? 'opacity-100' : 'opacity-0'
          )}>
            {showRating && (
              <div onClick={(e) => e.stopPropagation()}>
                <StarRating value={item.rating} onChange={handleRate} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right-click context menu */}
      {contextMenu && (
        <ContextMenuPortal position={contextMenu} onClose={() => setContextMenu(null)}>
          {albumId && (
            <MenuItem icon={<ImageIcon className="w-3.5 h-3.5" />} label="设为图集封面" onClick={handleSetAlbumCover} />
          )}
          {personId && (
            <MenuItem icon={<ImageIcon className="w-3.5 h-3.5" />} label="设为人物封面" onClick={handleSetPersonCover} />
          )}

          {extraMenuItems}

          {/* Quick rating */}
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

          <MenuSeparator />

          <MenuItem icon={<Info className="w-3.5 h-3.5" />} label="查看详情" onClick={() => { setContextMenu(null); setDetailOpen(true) }} />
          <MenuItem icon={<Trash2 className="w-3.5 h-3.5" />} label="删除" onClick={handleDelete} destructive />
        </ContextMenuPortal>
      )}

      <MediaDetailDialog open={detailOpen} onOpenChange={setDetailOpen} item={item} />
    </>
  )
}
