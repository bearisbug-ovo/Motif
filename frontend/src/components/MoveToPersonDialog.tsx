import { useState, useEffect } from 'react'
import { Search } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { personsApi, Person } from '@/api/persons'
import { mediaApi } from '@/api/media'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

interface MoveToPersonDialogProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  mediaIds: string[]
  currentPersonId?: string
  onComplete?: () => void
}

export function MoveToPersonDialog({ open, onOpenChange, mediaIds, currentPersonId, onComplete }: MoveToPersonDialogProps) {
  const [persons, setPersons] = useState<Person[]>([])
  const [search, setSearch] = useState('')
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setSearch('')
      setSelectedPersonId(null)
      personsApi.list('name').then(list => {
        setPersons(list.filter(p => p.id !== currentPersonId))
      }).catch(() => {})
    }
  }, [open, currentPersonId])

  const filtered = persons.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  )

  const handleMove = async () => {
    if (!selectedPersonId || mediaIds.length === 0) return
    setLoading(true)
    try {
      await mediaApi.batchUpdate({ ids: mediaIds, person_id: selectedPersonId, album_id: '' })
      toast({ title: `已移动 ${mediaIds.length} 张到其他人物` })
      onOpenChange(false)
      onComplete?.()
    } catch {
      toast({ title: '移动失败', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>移动到其他人物 ({mediaIds.length} 张)</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="搜索人物..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
            autoFocus
          />
        </div>

        <div className="max-h-60 overflow-y-auto space-y-1">
          {filtered.map((p) => (
            <button
              key={p.id}
              className={cn(
                'w-full px-3 py-2 text-left rounded text-sm hover:bg-accent flex items-center gap-3',
                selectedPersonId === p.id && 'bg-primary/20 text-primary'
              )}
              onClick={() => setSelectedPersonId(p.id)}
            >
              <div className="w-7 h-7 rounded-full bg-muted overflow-hidden shrink-0">
                {p.cover_file_path && <img src={mediaApi.thumbUrl(p.cover_file_path, 100)} alt="" className="w-full h-full object-cover" />}
              </div>
              <span className="truncate">{p.name}</span>
              <span className="text-xs text-muted-foreground shrink-0 ml-auto">{p.media_count} 张</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">没有找到匹配的人物</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleMove} disabled={!selectedPersonId || loading}>
            移动
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
