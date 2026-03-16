import { useState } from 'react'
import { Trash2, FolderInput, ArrowRightLeft, Star, X, CheckSquare, Briefcase, Sparkles, Unlink } from 'lucide-react'
import { useMediaStore } from '@/stores/media'
import { useWorkspaceStore } from '@/stores/workspace'
import { mediaApi } from '@/api/media'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { confirm } from '@/components/ConfirmDialog'
import { askDeleteChoice } from '@/components/DeleteChoiceDialog'
import { cn } from '@/lib/utils'

interface SelectionToolbarProps {
  personId?: string
  /** Which list to operate on: 'loose' for PersonHome, 'album' for AlbumDetail */
  scope?: 'loose' | 'album'
  onMoveToAlbum?: (ids: string[]) => void
  onMoveToPerson?: (ids: string[]) => void
  onBatchAi?: (ids: string[]) => void
  onRefresh?: () => void
}

export function SelectionToolbar({ personId, scope, onMoveToAlbum, onMoveToPerson, onBatchAi, onRefresh }: SelectionToolbarProps) {
  const { multiSelectMode, selectedIds, clearSelection, setMultiSelectMode, batchRate, batchDelete, items, looseItems } = useMediaStore()
  const { batchAdd } = useWorkspaceStore()
  const [ratingOpen, setRatingOpen] = useState(false)

  if (!multiSelectMode) return null

  // Scope-aware: only select/count items from the relevant list
  const scopedItems = scope === 'loose' ? looseItems : scope === 'album' ? items : [...items, ...looseItems]

  const count = selectedIds.size
  const totalCount = scopedItems.length
  const allSelected = totalCount > 0 && count === totalCount

  const handleSelectAll = () => {
    if (allSelected) {
      clearSelection()
    } else {
      useMediaStore.setState({ selectedIds: new Set(scopedItems.map(m => m.id)) })
    }
  }

  const handleBatchDelete = async () => {
    if (count === 0) return
    // Check if any selected item could be part of a generation chain
    const allItems = [...items, ...looseItems]
    const selectedItems = allItems.filter(m => selectedIds.has(m.id))
    const hasChainItems = selectedItems.some(m => m.source_type === 'generated' || m.parent_media_id)

    if (hasChainItems) {
      // Some items may have descendants — let user choose how to handle
      const choice = await askDeleteChoice(0)
      if (!choice) return
      try {
        await batchDelete(choice)
        toast({ title: `已删除 ${count} 张` })
        onRefresh?.()
      } catch {
        toast({ title: '删除失败', variant: 'destructive' })
      }
    } else {
      if (!await confirm({ title: `确定要删除 ${count} 张图片吗？` })) return
      try {
        await batchDelete()
        toast({ title: `已删除 ${count} 张` })
        onRefresh?.()
      } catch {
        toast({ title: '删除失败', variant: 'destructive' })
      }
    }
  }

  const handleBatchDetach = async () => {
    if (count === 0) return
    // Only detach items that are actually in a generation chain
    const allItems = [...items, ...looseItems]
    const chainItems = allItems.filter(m => selectedIds.has(m.id) && m.parent_media_id)
    if (chainItems.length === 0) {
      toast({ title: '所选图片均不在生成链中' })
      return
    }
    if (!await confirm({ title: `确定要将 ${chainItems.length} 张图片脱离生成链吗？`, description: '脱离后图片将变为本地图，不再关联原图。' })) return
    try {
      await mediaApi.batchDetach(chainItems.map(m => m.id))
      toast({ title: `已脱离 ${chainItems.length} 张` })
      onRefresh?.()
    } catch {
      toast({ title: '操作失败', variant: 'destructive' })
    }
  }

  const handleBatchRate = async (rating: number) => {
    try {
      await batchRate(rating)
      toast({ title: `已评分 ${count} 张` })
      setRatingOpen(false)
      onRefresh?.()
    } catch {
      toast({ title: '评分失败', variant: 'destructive' })
    }
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-card border-t border-border shadow-lg">
      <div className="flex items-center justify-between px-4 py-2 gap-2">
        <span className="text-sm font-medium shrink-0">已选 {count}</span>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" className="h-8" onClick={handleSelectAll}>
            <CheckSquare className="w-4 h-4 mr-1" />
            {allSelected ? '取消全选' : '全选'}
          </Button>
          <Button variant="ghost" size="sm" className="h-8" onClick={() => setMultiSelectMode(false)}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-2 px-4 pb-3 overflow-x-auto">
        {onMoveToAlbum && (
          <Button
            variant="outline" size="sm" className="h-8 shrink-0"
            disabled={count === 0}
            onClick={() => onMoveToAlbum([...selectedIds])}
          >
            <FolderInput className="w-4 h-4 mr-1" />
            移动到图集
          </Button>
        )}

        {onMoveToPerson && (
          <Button
            variant="outline" size="sm" className="h-8 shrink-0"
            disabled={count === 0}
            onClick={() => onMoveToPerson([...selectedIds])}
          >
            <ArrowRightLeft className="w-4 h-4 mr-1" />
            移动到其他人物
          </Button>
        )}

        <Button
          variant="outline" size="sm" className="h-8 shrink-0"
          disabled={count === 0}
          onClick={async () => {
            try {
              const res = await batchAdd([...selectedIds])
              toast({ title: `已添加 ${res.added} 张到工作区` })
            } catch {
              toast({ title: '添加失败', variant: 'destructive' })
            }
          }}
        >
          <Briefcase className="w-4 h-4 mr-1" />
          工作区
        </Button>

        <div className="relative shrink-0">
          <Button
            variant="outline" size="sm" className="h-8"
            disabled={count === 0}
            onClick={() => setRatingOpen(!ratingOpen)}
          >
            <Star className="w-4 h-4 mr-1" />
            评分
          </Button>
          {ratingOpen && (
            <div className="absolute bottom-full mb-1 left-0 bg-popover border border-border rounded-md shadow-lg p-2 flex gap-1">
              {[1, 2, 3, 4, 5].map((r) => (
                <button
                  key={r}
                  className="w-7 h-7 rounded text-sm font-medium hover:bg-accent"
                  onClick={() => handleBatchRate(r)}
                >
                  {r}
                </button>
              ))}
            </div>
          )}
        </div>

        {onBatchAi && (
          <Button
            variant="outline" size="sm" className="h-8 shrink-0"
            disabled={count === 0}
            onClick={() => onBatchAi([...selectedIds])}
          >
            <Sparkles className="w-4 h-4 mr-1" />
            AI 批量
          </Button>
        )}

        <Button
          variant="outline" size="sm" className="h-8 shrink-0"
          disabled={count === 0}
          onClick={handleBatchDetach}
        >
          <Unlink className="w-4 h-4 mr-1" />
          脱离生成链
        </Button>

        <Button
          variant="destructive" size="sm" className="h-8 shrink-0"
          disabled={count === 0}
          onClick={handleBatchDelete}
        >
          <Trash2 className="w-4 h-4 mr-1" />
          删除
        </Button>
      </div>
    </div>
  )
}
