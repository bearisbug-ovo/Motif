import { useEffect, useState } from 'react'
import { ArrowLeft, Briefcase } from 'lucide-react'
import { personsApi, Person } from '@/api/persons'
import { albumsApi, Album } from '@/api/albums'
import { mediaApi, MediaItem } from '@/api/media'
import { useWorkspaceStore } from '@/stores/workspace'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface FaceRefResult {
  id: string
  file_path: string
  person_id: string | null
}

interface FaceRefPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (media: FaceRefResult) => void
  title?: string
}

type PickerTab = 'workspace' | 'browse'
type BrowseStep = 'persons' | 'albums' | 'media'

export function FaceRefPicker({ open, onOpenChange, onSelect, title = '选择人脸参考图' }: FaceRefPickerProps) {
  const [tab, setTab] = useState<PickerTab>('workspace')

  // Browse state
  const [browseStep, setBrowseStep] = useState<BrowseStep>('persons')
  const [persons, setPersons] = useState<Person[]>([])
  const [albums, setAlbums] = useState<Album[]>([])
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([])
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null)
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null)

  // Workspace
  const { items: workspaceItems, fetchItems } = useWorkspaceStore()

  useEffect(() => {
    if (open) {
      fetchItems()
      personsApi.list().then(setPersons).catch(() => {})
    }
  }, [open, fetchItems])

  const handlePersonClick = async (person: Person) => {
    setSelectedPerson(person)
    const albumList = await albumsApi.listByPerson(person.id)
    setAlbums(albumList)
    // Also load loose media for this person
    const loose = await mediaApi.listLoose(person.id)
    setMediaItems(loose.filter(m => m.media_type === 'image'))
    setBrowseStep('albums')
  }

  const handleAlbumClick = async (album: Album) => {
    setSelectedAlbum(album)
    const items = await mediaApi.listByAlbum(album.id)
    setMediaItems(items.filter(m => m.media_type === 'image'))
    setBrowseStep('media')
  }

  const handleMediaSelect = (item: MediaItem) => {
    onSelect({ id: item.id, file_path: item.file_path, person_id: item.person_id })
    onOpenChange(false)
  }

  const handleBack = () => {
    if (browseStep === 'media') {
      if (selectedAlbum) {
        setSelectedAlbum(null)
        setBrowseStep('albums')
      } else {
        setBrowseStep('persons')
      }
    } else if (browseStep === 'albums') {
      setSelectedPerson(null)
      setBrowseStep('persons')
    }
  }

  const resetBrowse = () => {
    setBrowseStep('persons')
    setSelectedPerson(null)
    setSelectedAlbum(null)
    setMediaItems([])
    setAlbums([])
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetBrowse(); onOpenChange(v) }}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border pb-2">
          <Button
            variant={tab === 'workspace' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => { setTab('workspace'); resetBrowse() }}
          >
            <Briefcase className="w-4 h-4 mr-1" />
            工作区
          </Button>
          <Button
            variant={tab === 'browse' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => { setTab('browse'); resetBrowse() }}
          >
            浏览选择
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto min-h-[300px]">
          {tab === 'workspace' ? (
            workspaceItems.length > 0 ? (
              <div className="grid grid-cols-4 gap-2">
                {workspaceItems.filter(wi => wi.media?.media_type === 'image').map(wi => (
                  <button
                    key={wi.id}
                    className="aspect-square rounded-lg overflow-hidden bg-muted hover:ring-2 hover:ring-primary transition-all"
                    onClick={() => wi.media && handleMediaSelect(wi.media as any as MediaItem)}
                  >
                    {wi.media?.file_path && (
                      <img
                        src={`/api/files/thumb?path=${encodeURIComponent(wi.media.file_path)}&size=200`}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <p>工作区为空</p>
                <p className="text-xs mt-1">先将图片加入工作区再来选择</p>
              </div>
            )
          ) : (
            /* Browse mode */
            <div>
              {/* Back button */}
              {browseStep !== 'persons' && (
                <Button variant="ghost" size="sm" onClick={handleBack} className="mb-2">
                  <ArrowLeft className="w-4 h-4 mr-1" />
                  {browseStep === 'albums' ? selectedPerson?.name : selectedAlbum?.name || '未分类'}
                </Button>
              )}

              {browseStep === 'persons' && (
                <div className="grid grid-cols-3 gap-2">
                  {persons.map(p => (
                    <button
                      key={p.id}
                      className="flex flex-col items-center gap-1 p-2 rounded-lg hover:bg-accent transition-colors"
                      onClick={() => handlePersonClick(p)}
                    >
                      <div className="w-16 h-16 rounded-lg bg-muted overflow-hidden">
                        {p.cover_file_path ? (
                          <img
                            src={`/api/files/thumb?path=${encodeURIComponent(p.cover_file_path)}&size=100`}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                            {p.name.charAt(0)}
                          </div>
                        )}
                      </div>
                      <span className="text-xs truncate w-full text-center">{p.name}</span>
                    </button>
                  ))}
                </div>
              )}

              {browseStep === 'albums' && (
                <div className="space-y-2">
                  {/* Albums */}
                  {albums.length > 0 && (
                    <div className="grid grid-cols-3 gap-2">
                      {albums.map(a => (
                        <button
                          key={a.id}
                          className="flex flex-col items-center gap-1 p-2 rounded-lg hover:bg-accent transition-colors"
                          onClick={() => handleAlbumClick(a)}
                        >
                          <div className="w-16 h-16 rounded-lg bg-muted overflow-hidden">
                            {a.cover_file_path ? (
                              <img
                                src={`/api/files/thumb?path=${encodeURIComponent(a.cover_file_path)}&size=100`}
                                alt=""
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                                {a.name.charAt(0)}
                              </div>
                            )}
                          </div>
                          <span className="text-xs truncate w-full text-center">{a.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {/* Loose media (direct select) */}
                  {mediaItems.length > 0 && (
                    <>
                      <p className="text-xs text-muted-foreground mt-3 mb-1">未分类</p>
                      <div className="grid grid-cols-4 gap-2">
                        {mediaItems.map(m => (
                          <button
                            key={m.id}
                            className="aspect-square rounded-lg overflow-hidden bg-muted hover:ring-2 hover:ring-primary transition-all"
                            onClick={() => handleMediaSelect(m)}
                          >
                            <img
                              src={`/api/files/thumb?path=${encodeURIComponent(m.file_path)}&size=200`}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {browseStep === 'media' && (
                <div className="grid grid-cols-4 gap-2">
                  {mediaItems.map(m => (
                    <button
                      key={m.id}
                      className="aspect-square rounded-lg overflow-hidden bg-muted hover:ring-2 hover:ring-primary transition-all"
                      onClick={() => handleMediaSelect(m)}
                    >
                      <img
                        src={`/api/files/thumb?path=${encodeURIComponent(m.file_path)}&size=200`}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ))}
                  {mediaItems.length === 0 && (
                    <div className="col-span-4 text-center text-muted-foreground py-8">
                      此图集没有图片
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
