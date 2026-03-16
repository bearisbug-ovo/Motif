import { useState, useCallback } from 'react'
import { Check, Plus } from 'lucide-react'
import { useTagStore } from '@/stores/tag'
import { toast } from '@/hooks/use-toast'
import { Tag } from '@/api/tags'
import { SubMenuItem } from './ContextMenuPortal'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

interface TagEditorContentProps {
  selectedTagIds: string[]
  onToggle: (tagId: string, selected: boolean) => void
}

/** Core tag list + new tag input — used by both SubMenu and Dialog variants */
export function TagEditorContent({ selectedTagIds, onToggle }: TagEditorContentProps) {
  const { tags, createTag } = useTagStore()
  const [newName, setNewName] = useState('')

  const handleCreate = useCallback(async () => {
    const name = newName.trim()
    if (!name) return
    try {
      const tag = await createTag(name)
      setNewName('')
      onToggle(tag.id, true)
    } catch (err: any) {
      toast({ title: err.message || '创建标签失败', variant: 'destructive' })
    }
  }, [newName, createTag, onToggle])

  return (
    <div className="min-w-[160px]">
      {tags.length === 0 && (
        <div className="px-3 py-2 text-xs text-muted-foreground">暂无标签</div>
      )}
      {tags.map((t) => {
        const isSelected = selectedTagIds.includes(t.id)
        return (
          <button
            key={t.id}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-left"
            onClick={(e) => {
              e.stopPropagation()
              onToggle(t.id, !isSelected)
            }}
          >
            <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${isSelected ? 'bg-primary border-primary' : 'border-muted-foreground/30'}`}>
              {isSelected && <Check className="w-3 h-3 text-primary-foreground" />}
            </div>
            <span className="truncate">{t.name}</span>
          </button>
        )
      })}
      <div className="border-t border-border mt-1 pt-1 px-2 pb-1">
        <div className="flex items-center gap-1">
          <Input
            className="h-7 text-xs"
            placeholder="新建标签..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') handleCreate()
            }}
            onClick={(e) => e.stopPropagation()}
          />
          <button
            className="shrink-0 h-7 w-7 flex items-center justify-center rounded hover:bg-accent"
            onClick={(e) => { e.stopPropagation(); handleCreate() }}
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

/** PC: SubMenuItem wrapper for context menus */
export function TagEditorSubMenu({ selectedTagIds, onToggle }: TagEditorContentProps) {
  return (
    <SubMenuItem icon={<TagIcon />} label="管理标签">
      <TagEditorContent selectedTagIds={selectedTagIds} onToggle={onToggle} />
    </SubMenuItem>
  )
}

/** Mobile / Dialog wrapper */
export function TagEditorDialog({ open, onOpenChange, selectedTagIds, onToggle }: TagEditorContentProps & { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xs">
        <DialogHeader><DialogTitle>管理标签</DialogTitle></DialogHeader>
        <TagEditorContent selectedTagIds={selectedTagIds} onToggle={onToggle} />
      </DialogContent>
    </Dialog>
  )
}

function TagIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z" />
      <path d="M7 7h.01" />
    </svg>
  )
}
