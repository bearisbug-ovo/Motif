import { useState, useEffect, useMemo } from 'react'
import { Plus, Search, Users } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Album, albumsApi } from '@/api/albums'
import { personsApi, Person } from '@/api/persons'
import { mediaApi } from '@/api/media'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

interface MoveToAlbumDialogProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  mediaIds: string[]
  personId?: string
  onComplete?: () => void
}

export function MoveToAlbumDialog({ open, onOpenChange, mediaIds, personId, onComplete }: MoveToAlbumDialogProps) {
  const [albums, setAlbums] = useState<Album[]>([])
  const [persons, setPersons] = useState<Person[]>([])
  const [search, setSearch] = useState('')
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null)
  const [newAlbumName, setNewAlbumName] = useState('')
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showAllPersons, setShowAllPersons] = useState(false)
  // For cross-person new album creation
  const [newAlbumPersonId, setNewAlbumPersonId] = useState<string | undefined>(personId)

  useEffect(() => {
    if (open) {
      setSearch('')
      setSelectedAlbumId(null)
      setNewAlbumName('')
      setCreating(false)
      setShowAllPersons(false)
      setNewAlbumPersonId(personId)
      // Load albums
      if (personId) {
        albumsApi.listByPerson(personId).then(setAlbums).catch(() => {})
      } else {
        albumsApi.list().then(setAlbums).catch(() => {})
      }
    }
  }, [open, personId])

  // Load all albums + persons when switching to cross-person mode
  useEffect(() => {
    if (showAllPersons) {
      albumsApi.list().then(setAlbums).catch(() => {})
      personsApi.list('name').then(setPersons).catch(() => {})
    }
  }, [showAllPersons])

  const filtered = albums.filter((a) =>
    a.name.toLowerCase().includes(search.toLowerCase())
  )

  // Group albums by person when showing all
  const groupedAlbums = useMemo(() => {
    if (!showAllPersons) return null
    const groups: { person: Person | null; albums: Album[] }[] = []
    const personMap = new Map(persons.map(p => [p.id, p]))

    // Group by person_id
    const byPerson = new Map<string | null, Album[]>()
    for (const a of filtered) {
      const key = a.person_id || null
      if (!byPerson.has(key)) byPerson.set(key, [])
      byPerson.get(key)!.push(a)
    }

    // Current person first
    if (personId && byPerson.has(personId)) {
      groups.push({ person: personMap.get(personId) || null, albums: byPerson.get(personId)! })
      byPerson.delete(personId)
    }

    // Other persons
    for (const [pid, albums] of byPerson) {
      groups.push({ person: pid ? personMap.get(pid) || null : null, albums })
    }

    return groups
  }, [filtered, persons, showAllPersons, personId])

  const handleMove = async () => {
    if (!selectedAlbumId || mediaIds.length === 0) return
    setLoading(true)
    try {
      await mediaApi.batchUpdate({ ids: mediaIds, album_id: selectedAlbumId })
      toast({ title: `已移动 ${mediaIds.length} 张到图集` })
      onOpenChange(false)
      onComplete?.()
    } catch {
      toast({ title: '移动失败', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  const handleCreateAndMove = async () => {
    if (!newAlbumName.trim() || mediaIds.length === 0) return
    setLoading(true)
    try {
      const album = await albumsApi.create({
        name: newAlbumName.trim(),
        person_id: newAlbumPersonId,
      })
      await mediaApi.batchUpdate({ ids: mediaIds, album_id: album.id })
      toast({ title: `已创建图集并移动 ${mediaIds.length} 张` })
      onOpenChange(false)
      onComplete?.()
    } catch {
      toast({ title: '操作失败', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  const renderAlbumButton = (a: Album) => (
    <button
      key={a.id}
      className={cn(
        'w-full px-3 py-2 text-left rounded text-sm hover:bg-accent flex items-center justify-between',
        selectedAlbumId === a.id && 'bg-primary/20 text-primary'
      )}
      onClick={() => setSelectedAlbumId(a.id)}
    >
      <span className="truncate">{a.name}</span>
      <span className="text-xs text-muted-foreground shrink-0 ml-2">{a.media_count} 张</span>
    </button>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>移动到图集 ({mediaIds.length} 张)</DialogTitle>
        </DialogHeader>

        {creating ? (
          <div className="space-y-3">
            {showAllPersons && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">所属人物</label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={newAlbumPersonId || ''}
                  onChange={e => setNewAlbumPersonId(e.target.value || undefined)}
                >
                  <option value="">无归属</option>
                  {persons.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}
            <Input
              placeholder="新图集名称..."
              value={newAlbumName}
              onChange={(e) => setNewAlbumName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateAndMove()}
              autoFocus
            />
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setCreating(false)}>返回</Button>
              <Button size="sm" onClick={handleCreateAndMove} disabled={!newAlbumName.trim() || loading}>
                创建并移动
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="搜索图集..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                  autoFocus
                />
              </div>
              {personId && (
                <Button
                  variant={showAllPersons ? 'secondary' : 'ghost'}
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={() => setShowAllPersons(!showAllPersons)}
                  title={showAllPersons ? '仅当前人物' : '显示所有人物的图集'}
                >
                  <Users className="w-4 h-4" />
                </Button>
              )}
            </div>

            <div className="max-h-60 overflow-y-auto space-y-1">
              {showAllPersons && groupedAlbums ? (
                groupedAlbums.map((group, gi) => (
                  <div key={gi}>
                    <div className="sticky top-0 bg-popover px-2 py-1 text-xs font-medium text-muted-foreground border-b border-border/50">
                      {group.person?.name || '无归属'}
                      {group.person?.id === personId && ' (当前)'}
                    </div>
                    {group.albums.map(renderAlbumButton)}
                  </div>
                ))
              ) : (
                filtered.map(renderAlbumButton)
              )}
              {filtered.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">没有找到匹配的图集</p>
              )}
            </div>

            <button
              className="w-full px-3 py-2 text-left text-sm text-primary hover:bg-accent rounded flex items-center gap-2"
              onClick={() => setCreating(true)}
            >
              <Plus className="w-4 h-4" />
              新建图集
            </button>
          </>
        )}

        {!creating && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button onClick={handleMove} disabled={!selectedAlbumId || loading}>
              移动
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
