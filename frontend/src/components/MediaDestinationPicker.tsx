import { useEffect, useState, useMemo, useCallback } from 'react'
import { ChevronRight, ChevronLeft, Search, Plus, FolderOpen, User, ImageIcon } from 'lucide-react'
import { mediaApi } from '@/api/media'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { personsApi, Person } from '@/api/persons'
import { albumsApi, Album, AlbumCreate } from '@/api/albums'
import { toast } from '@/hooks/use-toast'

export interface MediaDestinationPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Current selected person */
  personId: string | null
  /** Current selected album */
  albumId: string | null
  /** Confirm selection */
  onConfirm: (personId: string | null, albumId: string | null) => void
}

export function MediaDestinationPicker({
  open, onOpenChange, personId, albumId, onConfirm,
}: MediaDestinationPickerProps) {
  const [persons, setPersons] = useState<Person[]>([])
  const [albums, setAlbums] = useState<Album[]>([])
  const [search, setSearch] = useState('')
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null)
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null)
  /** null = person list, string = viewing albums for that person, 'unclassified' = no person */
  const [viewingPerson, setViewingPerson] = useState<string | null | 'unclassified'>(null)
  const [creating, setCreating] = useState(false)
  const [newAlbumName, setNewAlbumName] = useState('')
  const [loading, setLoading] = useState(false)

  // Load persons on open
  useEffect(() => {
    if (!open) return
    setSearch('')
    setSelectedPersonId(personId)
    setSelectedAlbumId(albumId)
    setViewingPerson(null)
    setCreating(false)
    setNewAlbumName('')
    personsApi.list().then(setPersons).catch(() => {})
  }, [open, personId, albumId])

  // Load albums when viewing a person
  useEffect(() => {
    if (!open || viewingPerson === null) return
    setLoading(true)
    const pid = viewingPerson === 'unclassified' ? undefined : viewingPerson
    albumsApi.list(pid).then(list => {
      if (viewingPerson === 'unclassified') {
        setAlbums(list.filter(a => !a.person_id))
      } else {
        setAlbums(list)
      }
    }).catch(() => setAlbums([])).finally(() => setLoading(false))
  }, [open, viewingPerson])

  const filteredPersons = useMemo(() => {
    if (!search) return persons
    const q = search.toLowerCase()
    return persons.filter(p => p.name.toLowerCase().includes(q))
  }, [persons, search])

  const filteredAlbums = useMemo(() => {
    if (!search) return albums
    const q = search.toLowerCase()
    return albums.filter(a => a.name.toLowerCase().includes(q))
  }, [albums, search])

  const currentPersonName = useMemo(() => {
    if (viewingPerson === 'unclassified') return '未分类'
    return persons.find(p => p.id === viewingPerson)?.name || ''
  }, [viewingPerson, persons])

  const handleSelectPerson = useCallback((pid: string | null) => {
    setSelectedPersonId(pid)
    setSelectedAlbumId(null)
  }, [])

  const handleEnterPerson = useCallback((pid: string | 'unclassified') => {
    setViewingPerson(pid)
    setSearch('')
    setCreating(false)
  }, [])

  const handleBack = useCallback(() => {
    setViewingPerson(null)
    setSearch('')
    setCreating(false)
  }, [])

  const handleSelectAlbum = useCallback((aid: string | null) => {
    setSelectedAlbumId(aid)
  }, [])

  const handleCreateAlbum = useCallback(async () => {
    if (!newAlbumName.trim()) return
    try {
      const body: AlbumCreate = { name: newAlbumName.trim() }
      if (viewingPerson && viewingPerson !== 'unclassified') {
        body.person_id = viewingPerson
      }
      const album = await albumsApi.create(body)
      setAlbums(prev => [album, ...prev])
      setSelectedAlbumId(album.id)
      setCreating(false)
      setNewAlbumName('')
      toast({ title: `图集「${album.name}」已创建` })
    } catch (err: any) {
      toast({ title: '创建失败', description: err.message, variant: 'destructive' })
    }
  }, [newAlbumName, viewingPerson])

  const handleConfirm = useCallback(() => {
    onConfirm(selectedPersonId, selectedAlbumId)
    onOpenChange(false)
  }, [selectedPersonId, selectedAlbumId, onConfirm, onOpenChange])

  // Resolve display names
  const selectedPersonName = useMemo(() => {
    if (!selectedPersonId) return '未分类'
    return persons.find(p => p.id === selectedPersonId)?.name || selectedPersonId.slice(0, 8)
  }, [selectedPersonId, persons])

  const selectedAlbumName = useMemo(() => {
    if (!selectedAlbumId) return '散图'
    // Search in current albums list
    const a = albums.find(al => al.id === selectedAlbumId)
    return a?.name || selectedAlbumId.slice(0, 8)
  }, [selectedAlbumId, albums])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm max-h-[70vh] flex flex-col !gap-0 p-0">
        <DialogHeader className="px-4 pt-4 pb-2 shrink-0">
          <DialogTitle className="text-base">选择保存位置</DialogTitle>
        </DialogHeader>

        {/* Breadcrumb */}
        {viewingPerson !== null && (
          <div className="px-4 pb-2 flex items-center gap-1 text-sm">
            <button
              className="text-primary hover:underline"
              onClick={handleBack}
            >
              人物
            </button>
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">{currentPersonName}</span>
          </div>
        )}

        {/* Search */}
        <div className="px-4 pb-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder={viewingPerson !== null ? '搜索图集...' : '搜索人物...'}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-2 min-h-0" onWheel={e => e.stopPropagation()}>
          {viewingPerson === null ? (
            /* Person list */
            <div className="space-y-0.5 pb-2">
              {filteredPersons.map(p => (
                <button
                  key={p.id}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm hover:bg-accent transition-colors ${
                    selectedPersonId === p.id && !selectedAlbumId ? 'bg-accent' : ''
                  }`}
                  onClick={() => handleEnterPerson(p.id)}
                >
                  {p.cover_file_path ? (
                    <img src={`/api/files/thumb?path=${encodeURIComponent(p.cover_file_path)}&size=80`} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
                  ) : (
                    <User className="w-4 h-4 text-muted-foreground shrink-0" />
                  )}
                  <span className="flex-1 text-left truncate">{p.name}</span>
                  <span className="text-xs text-muted-foreground">{p.album_count} 图集</span>
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                </button>
              ))}
              {/* Unclassified entry */}
              <button
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm hover:bg-accent transition-colors border-t border-border mt-1 pt-2 ${
                  !selectedPersonId && !selectedAlbumId ? 'bg-accent' : ''
                }`}
                onClick={() => {
                  handleSelectPerson(null)
                  handleEnterPerson('unclassified')
                }}
              >
                <FolderOpen className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="flex-1 text-left">未分类</span>
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              </button>
            </div>
          ) : (
            /* Album list for selected person */
            <div className="space-y-0.5 pb-2">
              {/* "散图 (no album)" option */}
              <button
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm hover:bg-accent transition-colors ${
                  selectedPersonId === (viewingPerson === 'unclassified' ? null : viewingPerson) && !selectedAlbumId ? 'bg-primary/15 text-primary' : ''
                }`}
                onClick={() => {
                  handleSelectPerson(viewingPerson === 'unclassified' ? null : viewingPerson)
                  handleSelectAlbum(null)
                }}
              >
                <ImageIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="flex-1 text-left">散图（不归属图集）</span>
              </button>

              {loading ? (
                <div className="py-4 text-center text-xs text-muted-foreground">加载中...</div>
              ) : (
                filteredAlbums.map(a => (
                  <button
                    key={a.id}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm hover:bg-accent transition-colors ${
                      selectedAlbumId === a.id ? 'bg-primary/15 text-primary' : ''
                    }`}
                    onClick={() => {
                      handleSelectPerson(viewingPerson === 'unclassified' ? null : viewingPerson)
                      handleSelectAlbum(a.id)
                    }}
                  >
                    {a.cover_file_path ? (
                      <img src={`/api/files/thumb?path=${encodeURIComponent(a.cover_file_path)}&size=80`} alt="" className="w-7 h-7 rounded object-cover shrink-0" />
                    ) : (
                      <FolderOpen className="w-4 h-4 text-muted-foreground shrink-0" />
                    )}
                    <span className="flex-1 text-left truncate">{a.name}</span>
                    <span className="text-xs text-muted-foreground">{a.media_count}</span>
                  </button>
                ))
              )}

              {/* New album */}
              {creating ? (
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 mt-1">
                  <Input
                    placeholder="图集名称"
                    value={newAlbumName}
                    onChange={e => setNewAlbumName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleCreateAlbum(); if (e.key === 'Escape') setCreating(false) }}
                    className="h-7 text-sm flex-1"
                    autoFocus
                  />
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={handleCreateAlbum}>
                    确定
                  </Button>
                </div>
              ) : (
                <button
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-primary hover:bg-accent transition-colors mt-1 border-t border-border pt-2"
                  onClick={() => setCreating(true)}
                >
                  <Plus className="w-4 h-4 shrink-0" />
                  <span>新建图集</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Current selection display + actions */}
        <DialogFooter className="px-4 pb-4 pt-3 border-t border-border flex-row items-center gap-2">
          <div className="flex-1 text-xs text-muted-foreground truncate">
            已选: {selectedPersonName}{selectedAlbumId ? ` / ${selectedAlbumName}` : ' / 散图'}
          </div>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>取消</Button>
          <Button size="sm" onClick={handleConfirm}>确定</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
