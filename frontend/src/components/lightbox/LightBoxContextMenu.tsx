import {
  Trash2, ImageIcon, FolderInput, FolderOpen, ArrowRightLeft,
  Minimize, Briefcase, Unlink, GitBranch, Volume2, VolumeX, Star, Info, FileSearch,
  Crop, Scissors,
} from 'lucide-react'
import { mediaApi, MediaItem } from '@/api/media'
import { systemApi } from '@/api/system'
import { useLightboxStore } from '@/stores/lightbox'
import { useMediaStore } from '@/stores/media'
import { useAlbumStore } from '@/stores/album'
import { usePersonStore } from '@/stores/person'
import { useWorkspaceStore } from '@/stores/workspace'
import { ContextMenuPortal, MenuItem, MenuSeparator } from '../ContextMenuPortal'
import { AiMediaSubMenu } from '../AiContextMenu'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import type { VideoPlayerHandle } from '../video/VideoPlayer'

interface LightBoxContextMenuProps {
  position: { x: number; y: number } | null
  onClose: () => void
  immersive: boolean
  onToggleImmersive: () => void
  onDelete: () => void
  onShowInExplorer?: (item: MediaItem) => void
  onMoveToAlbum?: (item: MediaItem) => void
  onMoveToPerson?: (item: MediaItem) => void
  onAiAction?: (category: string, media: MediaItem) => void
  videoPlayerRef: React.RefObject<VideoPlayerHandle | null>
  videoMuted: boolean
  onOpenDetail: () => void
  onOpenChainPanel: () => void
  onRelocate?: () => void
  onCrop?: () => void
  onTrim?: () => void
}

export function LightBoxContextMenu({
  position, onClose, immersive, onToggleImmersive, onDelete,
  onShowInExplorer, onMoveToAlbum, onMoveToPerson, onAiAction,
  videoPlayerRef, videoMuted, onOpenDetail, onOpenChainPanel, onRelocate,
  onCrop, onTrim,
}: LightBoxContextMenuProps) {
  const { currentItem: item, context } = useLightboxStore()
  const { updateMedia } = useMediaStore()
  const { updateAlbum } = useAlbumStore()
  const { updatePerson } = usePersonStore()

  if (!position || !item) return null

  const isVideo = item.media_type === 'video'

  const handleSetAlbumCover = async () => {
    if (!context.albumId) return
    onClose()
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
    onClose()
    try {
      await updatePerson(context.personId, { cover_media_id: item.id })
      toast({ title: '已设为人物封面' })
      context.onCoverSet?.()
    } catch {
      toast({ title: '设置封面失败', variant: 'destructive' })
    }
  }

  const handleDetach = async () => {
    onClose()
    try {
      const updated = await mediaApi.detach(item.id)

      // The detached item is now source_type='local'.
      // Insert it into localItems right after the current local root,
      // remove it (and its descendants) from chainFlat, and reload chains.
      const lbState = useLightboxStore.getState()
      const isInChain = lbState.chainIndex >= 0

      if (isInChain) {
        // Collect IDs to remove from chainFlat: the detached item + all its descendants
        const detachedId = item.id
        const removeIds = new Set<string>([detachedId])
        for (const ci of lbState.chainFlat) {
          if (removeIds.has(ci.parent_media_id || '')) {
            removeIds.add(ci.id)
          }
        }
        const newChainFlat = lbState.chainFlat.filter(x => !removeIds.has(x.id))

        // Insert detached item into localItems after current local root
        const insertIdx = lbState.localIndex + 1
        const newLocalItems = [...lbState.localItems]
        newLocalItems.splice(insertIdx, 0, updated)

        useLightboxStore.setState({
          localItems: newLocalItems,
          localIndex: insertIdx,
          currentItem: updated,
          chainFlat: newChainFlat,
          chainIndex: -1,
        })
      } else {
        // Detaching a local item that was already root (has parent in another scope)
        useLightboxStore.setState((s) => ({
          localItems: s.localItems.map(x => x.id === item.id ? updated : x),
          currentItem: s.currentItem?.id === item.id ? updated : s.currentItem,
        }))
      }

      // Invalidate all chain caches and reload for new current local item
      useLightboxStore.getState().invalidateChainCache()

      // Update media store
      useMediaStore.setState((s) => ({
        items: s.items.map(x => x.id === item.id ? updated : x),
        looseItems: s.looseItems.map(x => x.id === item.id ? updated : x),
      }))
      toast({ title: '已脱离生成链' })
    } catch {
      toast({ title: '脱离失败', variant: 'destructive' })
    }
  }

  const handleQuickRate = async (rating: number) => {
    onClose()
    await updateMedia(item.id, { rating })
  }

  return (
    <ContextMenuPortal position={position} onClose={onClose}>
      {immersive ? (
        <MenuItem icon={<Minimize className="w-3.5 h-3.5" />} label="退出沉浸模式" onClick={() => { onClose(); onToggleImmersive() }} />
      ) : (
        <>
          {context.albumId && (
            <MenuItem icon={<ImageIcon className="w-3.5 h-3.5" />} label="设为图集封面" onClick={handleSetAlbumCover} />
          )}
          {context.personId && (
            <MenuItem icon={<ImageIcon className="w-3.5 h-3.5" />} label="设为人物封面" onClick={handleSetPersonCover} />
          )}
          {onAiAction && (
            <AiMediaSubMenu
              item={item}
              onAction={(cat) => { onClose(); onAiAction(cat, item) }}
            />
          )}
          {!isVideo && onCrop && (
            <MenuItem icon={<Crop className="w-3.5 h-3.5" />} label="裁剪" onClick={() => { onClose(); onCrop() }} />
          )}
          {isVideo && onTrim && (
            <MenuItem icon={<Scissors className="w-3.5 h-3.5" />} label="裁剪视频" onClick={() => { onClose(); onTrim() }} />
          )}
          {isVideo && (
            <MenuItem
              icon={videoMuted ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              label={videoMuted ? '取消静音' : '静音'}
              onClick={() => { onClose(); videoPlayerRef.current?.toggleMute() }}
            />
          )}
          <MenuItem icon={<Briefcase className="w-3.5 h-3.5" />} label="加入工作区" onClick={async () => {
            onClose()
            try {
              await useWorkspaceStore.getState().addItem(item.id)
              toast({ title: '已加入工作区' })
            } catch (err: any) {
              toast({ title: err.message || '添加失败', variant: 'destructive' })
            }
          }} />
          {onMoveToAlbum && (
            <MenuItem icon={<FolderInput className="w-3.5 h-3.5" />} label="移动到图集" onClick={() => { onClose(); onMoveToAlbum(item) }} />
          )}
          {onMoveToPerson && (
            <MenuItem icon={<ArrowRightLeft className="w-3.5 h-3.5" />} label="移动到其他人物" onClick={() => { onClose(); onMoveToPerson(item) }} />
          )}
          {onShowInExplorer && (
            <MenuItem icon={<FolderOpen className="w-3.5 h-3.5" />} label="在资源管理器中显示" onClick={() => { onClose(); onShowInExplorer(item) }} />
          )}
          {onRelocate && (
            <MenuItem icon={<FileSearch className="w-3.5 h-3.5" />} label="重新定位文件" onClick={() => { onClose(); onRelocate() }} />
          )}
          {!context.taskResultsMode && (
            <MenuItem icon={<GitBranch className="w-3.5 h-3.5" />} label="生成链" onClick={() => { onClose(); onOpenChainPanel() }} />
          )}
          {!context.taskResultsMode && item.parent_media_id && (
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
                  item.rating === r ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                )}
                onClick={() => handleQuickRate(r)}
              >
                {r}
              </button>
            ))}
          </div>

          <MenuSeparator />

          <MenuItem icon={<Info className="w-3.5 h-3.5" />} label="查看详情" onClick={() => { onClose(); onOpenDetail() }} />
          <MenuItem icon={<Trash2 className="w-3.5 h-3.5" />} label="删除" onClick={onDelete} destructive />
        </>
      )}
    </ContextMenuPortal>
  )
}
