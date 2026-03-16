import {
  X, Trash2, ImageIcon, FolderInput, FolderOpen,
  Shuffle, Maximize, Minimize, Briefcase,
} from 'lucide-react'
import { MediaItem } from '@/api/media'
import { useLightboxStore } from '@/stores/lightbox'
import { useMediaStore } from '@/stores/media'
import { useAlbumStore } from '@/stores/album'
import { usePersonStore } from '@/stores/person'
import { StarRating } from '../StarRating'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

interface LightBoxTopBarProps {
  visible: boolean
  immersive: boolean
  onToggleImmersive: () => void
  onDelete: () => void
  onShowInExplorer?: (item: MediaItem) => void
  onMoveToAlbum?: (item: MediaItem) => void
}

export function LightBoxTopBar({
  visible, immersive, onToggleImmersive, onDelete,
  onShowInExplorer, onMoveToAlbum,
}: LightBoxTopBarProps) {
  const { currentItem: item, context, localItems, localIndex, chainIndex, chainFlat, close } = useLightboxStore()
  const { updateMedia } = useMediaStore()
  const { updateAlbum } = useAlbumStore()
  const { updatePerson } = usePersonStore()

  if (!item) return null

  // Display index info
  const totalLocal = localItems.length
  const displayIdx = localIndex + 1
  const chainInfo = chainIndex >= 0 ? ` · 生成链 ${chainIndex + 1}/${chainFlat.length}` : ''

  const handleSetAlbumCover = async () => {
    if (!context.albumId) return
    try {
      await updateAlbum(context.albumId, { cover_media_id: item.id })
      toast({ title: '已设为图集封面' })
      context.onCoverSet?.()
    } catch {
      toast({ title: '设置封面失败', variant: 'destructive' })
    }
  }

  const handleSetPersonCover = async () => {
    if (!context.personId) return
    try {
      await updatePerson(context.personId, { cover_media_id: item.id })
      toast({ title: '已设为人物封面' })
      context.onCoverSet?.()
    } catch {
      toast({ title: '设置封面失败', variant: 'destructive' })
    }
  }

  return (
    <div
      className={cn(
        'flex items-center justify-between px-4 border-b border-white/10 shrink-0 transition-all duration-200',
        visible ? 'h-14 opacity-100' : 'h-0 opacity-0 pointer-events-none overflow-hidden'
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-sm text-white/60">
        {displayIdx} / {totalLocal}{chainInfo}
      </div>

      <StarRating
        value={item.rating}
        size="md"
        onChange={(r) => updateMedia(item.id, { rating: r })}
      />

      <div className="flex items-center gap-1">
        <button onClick={onDelete} className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors" title="删除">
          <Trash2 className="w-4 h-4" />
        </button>

        {onMoveToAlbum && (
          <button onClick={() => onMoveToAlbum(item)} className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors" title="移动到图集">
            <FolderInput className="w-4 h-4" />
          </button>
        )}

        {(context.albumId || context.personId) && (
          <button
            onClick={() => context.albumId ? handleSetAlbumCover() : handleSetPersonCover()}
            className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
            title="设为封面"
          >
            <ImageIcon className="w-4 h-4" />
          </button>
        )}

        {onShowInExplorer && (
          <button onClick={() => onShowInExplorer(item)} className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors" title="在资源管理器中显示">
            <FolderOpen className="w-4 h-4" />
          </button>
        )}

        {context.exploreMode && context.onReshuffle && (
          <button onClick={() => context.onReshuffle?.()} className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors" title="重新洗牌">
            <Shuffle className="w-4 h-4" />
          </button>
        )}

        <button onClick={onToggleImmersive} className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors" title="沉浸模式">
          <Maximize className="w-4 h-4" />
        </button>

        <button onClick={() => close()} className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>
    </div>
  )
}
