import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Download, Plus, Images } from 'lucide-react'
import { usePersonStore } from '@/stores/person'
import { useAlbumStore } from '@/stores/album'
import { useMediaStore, setOnRatingChange } from '@/stores/media'
import { AlbumCard } from '@/components/AlbumCard'
import { MediaCard } from '@/components/MediaCard'
import { ImportDialog } from '@/components/ImportDialog'
import { LightBox } from '@/components/LightBox'
import { StarRating } from '@/components/StarRating'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { toast } from '@/hooks/use-toast'

export function PersonHome() {
  const { personId } = useParams<{ personId: string }>()
  const navigate = useNavigate()
  const { currentPerson, fetchPerson } = usePersonStore()
  const { albums, fetchAlbumsByPerson, createAlbum } = useAlbumStore()
  const { looseItems, fetchLoose, openLightbox } = useMediaStore()
  const [importOpen, setImportOpen] = useState(false)
  const [createAlbumOpen, setCreateAlbumOpen] = useState(false)
  const [newAlbumName, setNewAlbumName] = useState('')

  useEffect(() => {
    if (!personId) return
    fetchPerson(personId)
    fetchAlbumsByPerson(personId)
    fetchLoose(personId)
  }, [personId, fetchPerson, fetchAlbumsByPerson, fetchLoose])

  const handleRefreshRatings = useCallback(() => {
    if (!personId) return
    fetchPerson(personId)
    fetchAlbumsByPerson(personId)
  }, [personId, fetchPerson, fetchAlbumsByPerson])

  useEffect(() => {
    setOnRatingChange(handleRefreshRatings)
    return () => setOnRatingChange(null)
  }, [handleRefreshRatings])

  const handleCreateAlbum = async () => {
    if (!newAlbumName.trim() || !personId) return
    try {
      await createAlbum({ name: newAlbumName.trim(), person_id: personId })
      setNewAlbumName('')
      setCreateAlbumOpen(false)
      fetchAlbumsByPerson(personId)
      toast({ title: '图集已创建' })
    } catch (err: any) {
      toast({ title: '创建失败', description: err.message, variant: 'destructive' })
    }
  }

  const handleRefresh = () => {
    if (!personId) return
    fetchPerson(personId)
    fetchAlbumsByPerson(personId)
    fetchLoose(personId)
  }

  if (!currentPerson) return (
    <div className="flex items-center justify-center h-full text-muted-foreground">加载中...</div>
  )

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Hero */}
      <div className="relative bg-gradient-to-b from-card to-background px-6 pt-4 pb-6 border-b border-border">
        <div className="flex items-center gap-2 mb-4">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-4 h-4 mr-1" />
            返回
          </Button>
        </div>
        <div className="flex items-end gap-6">
          <div className="w-24 h-24 rounded-xl bg-muted flex items-center justify-center shrink-0 overflow-hidden">
            {currentPerson.cover_file_path ? (
              <img
                src={`/api/files/thumb?path=${encodeURIComponent(currentPerson.cover_file_path)}&size=200`}
                alt={currentPerson.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <Images className="w-10 h-10 text-muted-foreground opacity-40" />
            )}
          </div>
          <div>
            <h1 className="text-2xl font-bold">{currentPerson.name}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {currentPerson.media_count} 张图片 · {currentPerson.album_count} 个图集
            </p>
            {currentPerson.avg_rating !== null && (
              <div className="mt-2">
                <StarRating value={Math.round(currentPerson.avg_rating)} readonly size="md" />
                <span className="text-xs text-muted-foreground ml-2">
                  {currentPerson.avg_rating.toFixed(1)} ({currentPerson.rated_count} 已评分)
                </span>
              </div>
            )}
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <Download className="w-4 h-4 mr-1.5" />
              导入
            </Button>
            <Button size="sm" onClick={() => setCreateAlbumOpen(true)}>
              <Plus className="w-4 h-4 mr-1.5" />
              新建图集
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 px-6 py-6 space-y-8">
        {/* Albums */}
        {albums.length > 0 && (
          <section>
            <h2 className="text-base font-semibold mb-4">图集 ({albums.length})</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {albums.map((a) => <AlbumCard key={a.id} album={a} />)}
            </div>
          </section>
        )}

        {/* Loose media */}
        {looseItems.length > 0 && (
          <section>
            <h2 className="text-base font-semibold mb-4">散图 ({looseItems.length})</h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2">
              {looseItems.map((m, i) => (
                <MediaCard
                  key={m.id}
                  item={m}
                  personId={personId}
                  onCoverSet={handleRefresh}
                  onClick={() => openLightbox(looseItems, i, { personId, onCoverSet: handleRefresh })}
                />
              ))}
            </div>
          </section>
        )}

        {albums.length === 0 && looseItems.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 gap-4 text-muted-foreground">
            <p>还没有图片，点击"导入"开始</p>
          </div>
        )}
      </div>

      <LightBox />
      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        defaultPersonId={personId}
        onComplete={handleRefresh}
      />

      <Dialog open={createAlbumOpen} onOpenChange={setCreateAlbumOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>新建图集</DialogTitle></DialogHeader>
          <Input
            placeholder="图集名称..."
            value={newAlbumName}
            onChange={(e) => setNewAlbumName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateAlbum()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateAlbumOpen(false)}>取消</Button>
            <Button onClick={handleCreateAlbum} disabled={!newAlbumName.trim()}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
