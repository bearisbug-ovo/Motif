import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Trash2, ImageIcon, Star } from 'lucide-react'
import { MediaItem, mediaApi } from '@/api/media'
import { StarRating } from './StarRating'
import { useMediaStore } from '@/stores/media'
import { useAlbumStore } from '@/stores/album'
import { usePersonStore } from '@/stores/person'
import { toast } from '@/hooks/use-toast'
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
}

export function MediaCard({ item, onClick, showActions = true, showRating = true, albumId, personId, onCoverSet }: MediaCardProps) {
  const [hovered, setHovered] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const { updateMedia, softDelete } = useMediaStore()
  const { updateAlbum } = useAlbumStore()
  const { updatePerson } = usePersonStore()

  const thumbUrl = mediaApi.thumbUrl(item.file_path, 400)

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

  return (
    <>
      <div
        className="relative group rounded-md overflow-hidden bg-card border border-border cursor-pointer select-none"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={onClick}
        onContextMenu={handleContextMenu}
      >
        <div className="aspect-square overflow-hidden">
          <img
            src={thumbUrl}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
            onError={(e) => { (e.target as HTMLImageElement).src = '/placeholder.svg' }}
          />
        </div>

        {/* Rating badge */}
        {item.rating !== null && item.rating > 0 && (
          <div className={cn(
            'absolute top-1.5 left-1.5 rounded px-1.5 py-0.5 flex items-center gap-0.5',
            BADGE_COLORS[item.rating] || 'bg-black/60'
          )}>
            <span className="text-xs text-white font-medium">★{item.rating}</span>
          </div>
        )}

        {/* Source type badge */}
        {item.source_type !== 'local' && (
          <div className={cn(
            'absolute top-1.5 right-1.5 text-xs px-1.5 py-0.5 rounded',
            item.source_type === 'generated' ? 'bg-primary/80 text-white' : 'bg-blue-600/80 text-white'
          )}>
            {item.source_type === 'generated' ? 'AI' : '截图'}
          </div>
        )}

        {/* Hover overlay */}
        {showActions && (
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
      {contextMenu && createPortal(
        <div
          className="fixed z-[200] bg-popover border border-border rounded-md shadow-lg py-1 min-w-[160px] text-sm"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Set as album cover */}
          {albumId && (
            <button
              className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-accent"
              onClick={handleSetAlbumCover}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              设为图集封面
            </button>
          )}

          {/* Set as person cover */}
          {personId && (
            <button
              className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-accent"
              onClick={handleSetPersonCover}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              设为人物封面
            </button>
          )}

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
    </>
  )
}
