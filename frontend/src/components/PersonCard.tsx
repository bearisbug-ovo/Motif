import { useState, useCallback } from 'react'
import { MoreHorizontal, Edit2, Trash2, Images, Download, Plus, Trash, FolderX } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Person } from '@/api/persons'
import { mediaApi } from '@/api/media'
import { ContextMenuPortal, MenuItem, MenuSeparator } from './ContextMenuPortal'
import { TagEditorSubMenu, TagEditorDialog } from './TagEditor'
import { usePersonStore } from '@/stores/person'
import { useTagStore } from '@/stores/tag'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

interface PersonCardProps {
  person: Person
  compact?: boolean
  animIndex?: number
  onImport?: () => void
  onCreateAlbum?: () => void
  onCleanupLowRated?: () => void
  onCleanupEmptyAlbums?: () => void
}

export function PersonCard({ person, compact, animIndex, onImport, onCreateAlbum, onCleanupLowRated, onCleanupEmptyAlbums }: PersonCardProps) {
  const navigate = useNavigate()
  const { updatePerson, deletePerson } = usePersonStore()
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteMode, setDeleteMode] = useState<'person_only' | 'person_and_albums' | 'all'>('person_only')
  const [newName, setNewName] = useState(person.name)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [tagDialogOpen, setTagDialogOpen] = useState(false)
  const isMobileDevice = typeof window !== 'undefined' && window.innerWidth < 768

  const selectedTagIds = (person.tags || []).map(t => t.id)
  const handleTagToggle = useCallback(async (tagId: string, selected: boolean) => {
    const currentIds = (person.tags || []).map(t => t.id)
    const newIds = selected ? [...currentIds, tagId] : currentIds.filter(id => id !== tagId)
    await updatePerson(person.id, { tag_ids: newIds })
    useTagStore.getState().fetchTags()
  }, [person.id, person.tags, updatePerson])

  const thumbUrl = person.cover_file_path
    ? mediaApi.thumbUrl(person.cover_file_path, 400)
    : null

  const handleRename = async () => {
    if (newName.trim()) {
      await updatePerson(person.id, { name: newName.trim() })
      setRenameOpen(false)
    }
  }

  const handleDelete = async () => {
    await deletePerson(person.id, deleteMode)
    setDeleteOpen(false)
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  return (
    <>
      <div
        data-testid="person-card"
        data-person-id={person.id}
        className="group relative rounded-none sm:rounded-lg overflow-hidden bg-card border border-border cursor-pointer hover:border-primary/50 transition-all duration-200 hover:shadow-lg hover:shadow-black/30 animate-fade-in-up"
        style={animIndex != null ? { animationDelay: `${Math.min(animIndex * 30, 600)}ms` } : undefined}
        onClick={() => navigate(`/persons/${person.id}`)}
        onContextMenu={handleContextMenu}
      >
        {/* Square cover */}
        <div className="aspect-square overflow-hidden bg-muted relative">
          {thumbUrl ? (
            <img src={thumbUrl} alt={person.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
              <Images className="w-12 h-12 opacity-30" />
            </div>
          )}

          {/* Rating badge — top left, hidden on mobile & compact */}
          {!compact && person.avg_rating != null && (
            <div className="absolute top-1.5 left-1.5 bg-black/60 rounded px-1.5 py-0.5 hidden sm:block">
              <span className="text-xs text-white font-medium">★{person.avg_rating.toFixed(1)}</span>
            </div>
          )}

          {/* Dropdown menu — top right, hover only, hidden on mobile (use long-press context menu instead) */}
          <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity z-10 hidden sm:block">
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 bg-black/40 hover:bg-black/60 text-white"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem onClick={() => { setNewName(person.name); setRenameOpen(true) }}>
                  <Edit2 className="w-4 h-4 mr-2" />
                  重命名
                </DropdownMenuItem>
                {onImport && (
                  <DropdownMenuItem onClick={onImport}>
                    <Download className="w-4 h-4 mr-2" />
                    导入
                  </DropdownMenuItem>
                )}
                {onCreateAlbum && (
                  <DropdownMenuItem onClick={onCreateAlbum}>
                    <Plus className="w-4 h-4 mr-2" />
                    新建图集
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                {onCleanupEmptyAlbums && (
                  <DropdownMenuItem onClick={onCleanupEmptyAlbums}>
                    <FolderX className="w-4 h-4 mr-2" />
                    清理空图集
                  </DropdownMenuItem>
                )}
                {onCleanupLowRated && (
                  <DropdownMenuItem onClick={onCleanupLowRated}>
                    <Trash className="w-4 h-4 mr-2" />
                    清理低分图
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem className="text-destructive" onClick={() => setDeleteOpen(true)}>
                  <Trash2 className="w-4 h-4 mr-2" />
                  删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Bottom gradient overlay with info — hidden when compact (tiny cards) */}
          {!compact && (
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent px-2 pb-1.5 pt-6">
              <h3 className="text-white font-medium truncate text-sm">{person.name}</h3>
              <p className="text-xs text-white/70 truncate">
                {person.media_count} 张 · {person.album_count} 个图集
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenuPortal position={contextMenu} onClose={() => setContextMenu(null)}>
          <MenuItem
            icon={<Edit2 className="w-3.5 h-3.5" />}
            label="重命名人物"
            onClick={() => { setContextMenu(null); setNewName(person.name); setRenameOpen(true) }}
          />
          {isMobileDevice ? (
            <MenuItem
              icon={<TagIconSmall />}
              label="管理标签"
              onClick={() => { setContextMenu(null); setTagDialogOpen(true) }}
            />
          ) : (
            <TagEditorSubMenu selectedTagIds={selectedTagIds} onToggle={handleTagToggle} />
          )}
          {onImport && (
            <MenuItem icon={<Download className="w-3.5 h-3.5" />} label="导入" onClick={() => { setContextMenu(null); onImport() }} />
          )}
          {onCreateAlbum && (
            <MenuItem icon={<Plus className="w-3.5 h-3.5" />} label="新建图集" onClick={() => { setContextMenu(null); onCreateAlbum() }} />
          )}
          <MenuSeparator />
          {onCleanupEmptyAlbums && (
            <MenuItem icon={<FolderX className="w-3.5 h-3.5" />} label="清理空图集" onClick={() => { setContextMenu(null); onCleanupEmptyAlbums() }} />
          )}
          {onCleanupLowRated && (
            <MenuItem icon={<Trash className="w-3.5 h-3.5" />} label="清理低分图" onClick={() => { setContextMenu(null); onCleanupLowRated() }} />
          )}
          <MenuItem
            icon={<Trash2 className="w-3.5 h-3.5" />}
            label="删除人物"
            onClick={() => { setContextMenu(null); setDeleteOpen(true) }}
            destructive
          />
        </ContextMenuPortal>
      )}

      {/* Rename dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名人物</DialogTitle>
          </DialogHeader>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRename()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>取消</Button>
            <Button onClick={handleRename}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除人物 "{person.name}"</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {(['person_only', 'person_and_albums', 'all'] as const).map((mode) => (
              <label key={mode} className="flex items-start gap-3 cursor-pointer p-3 rounded border border-border hover:bg-accent">
                <input
                  type="radio"
                  name="delete-mode"
                  value={mode}
                  checked={deleteMode === mode}
                  onChange={() => setDeleteMode(mode)}
                  className="mt-0.5"
                />
                <div>
                  <div className="text-sm font-medium">
                    {mode === 'person_only' ? '仅删除人物' :
                     mode === 'person_and_albums' ? '删除人物和图集' :
                     '删除全部（含图片）'}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {mode === 'person_only' ? '图集和图片保留，仅解除关联' :
                     mode === 'person_and_albums' ? '删除图集，图片移入未分类' :
                     '所有图片移入回收站'}
                  </div>
                </div>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>取消</Button>
            <Button variant="destructive" onClick={handleDelete}>确认删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TagEditorDialog open={tagDialogOpen} onOpenChange={setTagDialogOpen} selectedTagIds={selectedTagIds} onToggle={handleTagToggle} />
    </>
  )
}

function TagIconSmall() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z" />
      <path d="M7 7h.01" />
    </svg>
  )
}
