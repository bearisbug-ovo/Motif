import { useState } from 'react'
import { MoreHorizontal, Edit2, Trash2, Images } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Person } from '@/api/persons'
import { mediaApi } from '@/api/media'
import { StarRating } from './StarRating'
import { usePersonStore } from '@/stores/person'
import { cn } from '@/lib/utils'
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
}

export function PersonCard({ person }: PersonCardProps) {
  const navigate = useNavigate()
  const { updatePerson, deletePerson } = usePersonStore()
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteMode, setDeleteMode] = useState<'person_only' | 'person_and_albums' | 'all'>('person_only')
  const [newName, setNewName] = useState(person.name)

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

  return (
    <>
      <div
        className="group relative rounded-lg overflow-hidden bg-card border border-border cursor-pointer hover:border-primary/50 transition-colors"
        onClick={() => navigate(`/persons/${person.id}`)}
      >
        {/* Cover image */}
        <div className="aspect-[3/4] overflow-hidden bg-muted">
          {thumbUrl ? (
            <img src={thumbUrl} alt={person.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
              <Images className="w-12 h-12 opacity-30" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="font-medium text-sm truncate">{person.name}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {person.media_count} 张 · {person.album_count} 个图集
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem onClick={() => { setNewName(person.name); setRenameOpen(true) }}>
                  <Edit2 className="w-4 h-4 mr-2" />
                  重命名
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive" onClick={() => setDeleteOpen(true)}>
                  <Trash2 className="w-4 h-4 mr-2" />
                  删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {person.avg_rating !== null && (
            <div className="mt-2 flex items-center gap-1.5">
              <StarRating value={Math.round(person.avg_rating)} readonly />
              <span className="text-xs text-muted-foreground">
                {person.avg_rating.toFixed(1)} ({person.rated_count})
              </span>
            </div>
          )}
        </div>
      </div>

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
    </>
  )
}
