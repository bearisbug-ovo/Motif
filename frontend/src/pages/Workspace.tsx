import { useEffect, useCallback, useState } from 'react'
import { Trash2, X, GripVertical, FolderInput, FolderOpen, Star, Info } from 'lucide-react'
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useWorkspaceStore } from '@/stores/workspace'
import { WorkspaceItem } from '@/api/workspace'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { useGridZoom } from '@/hooks/useGridZoom'
import { EmptyState } from '@/components/Skeleton'
import { ContextMenuPortal, MenuItem, MenuSeparator } from '@/components/ContextMenuPortal'
import { AiMediaSubMenu } from '@/components/AiContextMenu'
import { MoveToAlbumDialog } from '@/components/MoveToAlbumDialog'
import { MediaDetailDialog } from '@/components/MediaDetailDialog'
import { LightBox } from '@/components/LightBox'
import { useMediaStore } from '@/stores/media'
import { mediaApi, MediaItem } from '@/api/media'
import { cn } from '@/lib/utils'
import { Briefcase } from 'lucide-react'

export function Workspace() {
  const { items, loading, fetchItems, removeItem, clear, reorder } = useWorkspaceStore()
  const { containerRef, gridStyle } = useGridZoom({ pageKey: 'workspace' })
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; item: WorkspaceItem } | null>(null)
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveTarget, setMoveTarget] = useState<string[]>([])
  const [detailItem, setDetailItem] = useState<any>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  )

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  const handleClear = async () => {
    if (items.length === 0) return
    try {
      await clear()
      toast({ title: '工作区已清空' })
    } catch (err: any) {
      toast({ title: '清空失败', description: err.message, variant: 'destructive' })
    }
  }

  const handleRemove = async (itemId: string) => {
    try {
      await removeItem(itemId)
    } catch (err: any) {
      toast({ title: '移除失败', description: err.message, variant: 'destructive' })
    }
  }

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = items.findIndex(i => i.id === active.id)
    const newIndex = items.findIndex(i => i.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const reordered = arrayMove(items, oldIndex, newIndex)
    // Optimistic update
    useWorkspaceStore.setState({ items: reordered })
    try {
      await reorder(reordered.map(i => i.id))
    } catch (err: any) {
      toast({ title: '排序失败', description: err.message, variant: 'destructive' })
      fetchItems()
    }
  }, [items, reorder, fetchItems])

  return (
    <div data-testid="workspace-page" className="flex flex-col h-full">
      <div className="border-b border-border shrink-0">
        <div className="flex items-center justify-between px-6 h-14 max-w-2xl mx-auto">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">工作区</h1>
            <span className="text-sm text-muted-foreground">{items.length}/100</span>
          </div>
          <Button variant="outline" size="sm" onClick={handleClear} disabled={items.length === 0}>
            <Trash2 className="w-4 h-4 mr-1" />
            清空
          </Button>
        </div>
      </div>

      <div ref={containerRef} className="flex-1 overflow-auto px-1 sm:px-6 py-2 sm:py-6 pb-28 md:pb-4">
        {items.length > 0 ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map(i => i.id)} strategy={rectSortingStrategy}>
              <div style={gridStyle}>
                {items.map((item, i) => (
                  <SortableWorkspaceCard key={item.id} item={item} onRemove={handleRemove}
                    onClick={() => {
                      const mediaItems = items.filter(wi => wi.media).map(wi => ({
                        ...wi.media!,
                        album_id: wi.media!.album_id || null,
                        parent_media_id: null, workflow_type: null, generation_params: null,
                        video_timestamp: null, sort_order: 0, thumbnail_path: null,
                        file_size: null, is_deleted: false, deleted_at: null,
                        created_at: '', updated_at: '',
                      } as MediaItem))
                      useMediaStore.getState().openLightbox(mediaItems, i)
                    }}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, item }) }}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <EmptyState
            icon={Briefcase}
            title="工作区为空"
            description="在图片右键菜单中选择「加入工作区」"
          />
        )}
      </div>

      {/* Context menu */}
      {ctxMenu && ctxMenu.item.media && (() => {
        const m = ctxMenu.item.media!
        return (
          <ContextMenuPortal position={ctxMenu} onClose={() => setCtxMenu(null)}>
            <AiMediaSubMenu item={m as any} onAction={(cat) => { setCtxMenu(null) }} />
            <MenuItem icon={<FolderInput className="w-3.5 h-3.5" />} label="移动到图集" onClick={() => { setMoveTarget([m.id]); setMoveOpen(true); setCtxMenu(null) }} />
            <MenuItem icon={<FolderOpen className="w-3.5 h-3.5" />} label="在资源管理器中显示" onClick={() => { mediaApi.showInExplorer(m.id); setCtxMenu(null) }} />
            <div className="px-3 py-1.5 flex items-center gap-1">
              <Star className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-muted-foreground text-xs mr-1">评分</span>
              {[1, 2, 3, 4, 5].map((r) => (
                <button key={r} className={cn('w-5 h-5 rounded text-xs font-medium transition-colors', m.rating === r ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}
                  onClick={async () => { await useMediaStore.getState().updateMedia(m.id, { rating: r }); setCtxMenu(null); fetchItems() }}>{r}</button>
              ))}
            </div>
            <MenuSeparator />
            <MenuItem icon={<Info className="w-3.5 h-3.5" />} label="查看详情" onClick={() => { setDetailItem(m); setCtxMenu(null) }} />
            <MenuItem icon={<X className="w-3.5 h-3.5" />} label="从工作区移除" onClick={async () => { await handleRemove(ctxMenu.item.id); setCtxMenu(null) }} />
            <MenuItem icon={<Trash2 className="w-3.5 h-3.5" />} label="删除" destructive onClick={async () => {
              setCtxMenu(null)
              if (confirm('确定要删除这张图片吗？')) {
                await useMediaStore.getState().softDelete(m.id)
                fetchItems()
              }
            }} />
          </ContextMenuPortal>
        )
      })()}

      <MoveToAlbumDialog open={moveOpen} onOpenChange={setMoveOpen} mediaIds={moveTarget} />
      <MediaDetailDialog open={!!detailItem} onOpenChange={(o) => { if (!o) setDetailItem(null) }} item={detailItem} />
      <LightBox />
    </div>
  )
}

function SortableWorkspaceCard({ item, onRemove, onClick, onContextMenu }: { item: WorkspaceItem; onRemove: (id: string) => void; onClick?: () => void; onContextMenu?: (e: React.MouseEvent) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className="group relative aspect-square rounded-none sm:rounded-lg overflow-hidden bg-muted cursor-pointer"
      onClick={onClick} onContextMenu={onContextMenu}>
      {item.media?.file_path && (
        <img
          src={`/api/files/thumb?path=${encodeURIComponent(item.media.file_path)}&size=200`}
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
        />
      )}
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="absolute top-1 left-1 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-grab touch-none"
      >
        <GripVertical className="w-3.5 h-3.5 text-white" />
      </button>
      {/* Hover remove button */}
      <button
        onClick={() => onRemove(item.id)}
        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <X className="w-3.5 h-3.5 text-white" />
      </button>
    </div>
  )
}
