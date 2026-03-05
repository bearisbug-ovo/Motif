import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Download, Plus, Images, Edit2, FolderInput, FolderOpen, Shuffle, ZoomIn, Briefcase, Repeat, Paintbrush, Trash2 } from 'lucide-react'
import { usePersonStore } from '@/stores/person'
import { useAlbumStore } from '@/stores/album'
import { useMediaStore, setOnRatingChange } from '@/stores/media'
import { AlbumCard } from '@/components/AlbumCard'
import { MediaCard } from '@/components/MediaCard'
import { ImportDialog } from '@/components/ImportDialog'
import { MoveToAlbumDialog } from '@/components/MoveToAlbumDialog'
import { SelectionToolbar } from '@/components/SelectionToolbar'
import { UpscaleDrawer } from '@/components/UpscaleDrawer'
import { FaceSwapDrawer } from '@/components/FaceSwapDrawer'
import { MaskEditor } from '@/components/MaskEditor'
import { LightBox } from '@/components/LightBox'
import { FilterBar } from '@/components/FilterBar'
import { StarRating } from '@/components/StarRating'
import { ContextMenuPortal, MenuItem, MenuSeparator } from '@/components/ContextMenuPortal'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { mediaApi, MediaItem } from '@/api/media'
import { useWorkspaceStore } from '@/stores/workspace'
import { toast } from '@/hooks/use-toast'
import { useGridZoom, isMobile } from '@/hooks/useGridZoom'

export function PersonHome() {
  const { personId } = useParams<{ personId: string }>()
  const navigate = useNavigate()
  const { currentPerson, fetchPerson, updatePerson } = usePersonStore()
  const albumStore = useAlbumStore()
  const { albums, fetchAlbumsByPerson, createAlbum } = albumStore
  const { looseItems, fetchLoose, openLightbox, multiSelectMode, setMultiSelectMode, selectedIds, toggleSelection, sort, filterRating, sourceType, setSort, setFilterRating, setSourceType, resetFilters: resetMediaFilters } = useMediaStore()
  const [importOpen, setImportOpen] = useState(false)
  const [createAlbumOpen, setCreateAlbumOpen] = useState(false)
  const [newAlbumName, setNewAlbumName] = useState('')
  const [areaMenu, setAreaMenu] = useState<{ x: number; y: number } | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameName, setRenameName] = useState('')
  const [moveTarget, setMoveTarget] = useState<string[]>([])
  const [moveOpen, setMoveOpen] = useState(false)
  const [upscaleMedia, setUpscaleMedia] = useState<MediaItem | null>(null)
  const [faceSwapMedia, setFaceSwapMedia] = useState<MediaItem | null>(null)
  const [inpaintMedia, setInpaintMedia] = useState<MediaItem | null>(null)
  const [cleanupOpen, setCleanupOpen] = useState(false)
  const [cleanupThreshold, setCleanupThreshold] = useState(2)
  const { value: cols, containerRef, gridStyle } = useGridZoom({ pageKey: 'person-home' })
  const compact = cols >= (isMobile ? 4 : 10)

  const handleShowInExplorer = useCallback((item: MediaItem) => {
    mediaApi.showInExplorer(item.id).catch(() => toast({ title: '无法打开', variant: 'destructive' }))
  }, [])

  const handleMoveToAlbum = useCallback((item: MediaItem) => {
    setMoveTarget([item.id])
    setMoveOpen(true)
  }, [])

  const handleRefresh = useCallback(() => {
    if (!personId) return
    fetchPerson(personId)
    fetchAlbumsByPerson(personId)
    fetchLoose(personId)
  }, [personId, fetchPerson, fetchAlbumsByPerson, fetchLoose])

  const shuffleArray = <T,>(arr: T[]): T[] => {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }

  const handleExplore = useCallback(async () => {
    try {
      const all = await mediaApi.explore({ person_id: personId })
      if (all.length === 0) return
      const shuffled = shuffleArray(all)
      const onReshuffle = async () => {
        const items = await mediaApi.explore({ person_id: personId })
        const re = shuffleArray(items)
        useMediaStore.setState({ lightboxItems: re, lightboxIndex: 0 })
      }
      openLightbox(shuffled, 0, {
        personId,
        onCoverSet: handleRefresh,
        exploreMode: true,
        onReshuffle,
      })
    } catch {}
  }, [personId, openLightbox, handleRefresh])

  useEffect(() => {
    if (!personId) return
    albumStore.resetFilters()
    resetMediaFilters('person-loose')
    fetchPerson(personId)
    fetchAlbumsByPerson(personId)
    fetchLoose(personId)
  }, [personId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefreshRatings = useCallback(() => {
    if (!personId) return
    fetchPerson(personId)
    fetchAlbumsByPerson(personId)
  }, [personId, fetchPerson, fetchAlbumsByPerson])

  useEffect(() => {
    setOnRatingChange(handleRefreshRatings)
    return () => setOnRatingChange(null)
  }, [handleRefreshRatings])

  const handleBatchCleanup = useCallback(async () => {
    const allMedia = await mediaApi.explore({ person_id: personId })
    const lowScoreIds = allMedia
      .filter(m => m.rating !== null && m.rating <= cleanupThreshold)
      .map(m => m.id)
    if (lowScoreIds.length === 0) {
      toast({ title: '没有符合条件的低分图' })
      setCleanupOpen(false)
      return
    }
    if (!confirm(`确定要删除 ${lowScoreIds.length} 张 ${cleanupThreshold} 星及以下的图片吗？`)) return
    try {
      await mediaApi.batchDelete(lowScoreIds)
      toast({ title: `已删除 ${lowScoreIds.length} 张低分图` })
      setCleanupOpen(false)
      handleRefresh()
    } catch (err: any) {
      toast({ title: '批量删除失败', description: err.message, variant: 'destructive' })
    }
  }, [personId, cleanupThreshold, handleRefresh])

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

  if (!currentPerson) return (
    <div className="flex items-center justify-center h-full text-muted-foreground">加载中...</div>
  )

  return (
    <div data-testid="person-home-page" className="flex flex-col h-full overflow-auto">
      {/* Hero */}
      <div className="relative bg-gradient-to-b from-card to-background px-3 sm:px-6 pt-3 sm:pt-4 pb-4 sm:pb-6 border-b border-border">
        <div className="flex items-center gap-2 mb-2 sm:mb-4">
          <Button variant="ghost" size="sm" className="h-7 sm:h-8" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-4 h-4 mr-1" />
            <span className="hidden sm:inline">返回</span>
          </Button>
        </div>
        <div className="flex items-end gap-3 sm:gap-6">
          <div className="w-16 h-16 sm:w-24 sm:h-24 rounded-lg sm:rounded-xl bg-muted flex items-center justify-center shrink-0 overflow-hidden">
            {currentPerson.cover_file_path ? (
              <img
                src={`/api/files/thumb?path=${encodeURIComponent(currentPerson.cover_file_path)}&size=200`}
                alt={currentPerson.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <Images className="w-8 h-8 sm:w-10 sm:h-10 text-muted-foreground opacity-40" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg sm:text-2xl font-bold truncate">{currentPerson.name}</h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1">
              {currentPerson.media_count} 张 · {currentPerson.album_count} 图集
            </p>
            {currentPerson.avg_rating !== null && (
              <div className="mt-1 sm:mt-2 flex items-center">
                <StarRating value={Math.round(currentPerson.avg_rating)} readonly size="md" />
                <span className="text-[10px] sm:text-xs text-muted-foreground ml-1.5 sm:ml-2">
                  {currentPerson.avg_rating.toFixed(1)} ({currentPerson.rated_count})
                </span>
              </div>
            )}
          </div>
          <div className="flex gap-1 sm:gap-2 shrink-0">
            <Button variant="outline" size="sm" className="h-7 sm:h-8 w-7 sm:w-auto p-0 sm:px-3" onClick={handleExplore}>
              <Shuffle className="w-3.5 h-3.5 sm:w-4 sm:h-4 sm:mr-1" />
              <span className="hidden sm:inline">随机</span>
            </Button>
            <Button variant={multiSelectMode ? 'default' : 'outline'} size="sm" className="h-7 sm:h-8 text-xs sm:text-sm px-2 sm:px-3" onClick={() => setMultiSelectMode(!multiSelectMode)}>
              多选
            </Button>
            <Button variant="outline" size="sm" className="h-7 sm:h-8 w-7 sm:w-auto p-0 sm:px-3" onClick={() => setImportOpen(true)}>
              <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4 sm:mr-1.5" />
              <span className="hidden sm:inline">导入</span>
            </Button>
            <Button size="sm" className="h-7 sm:h-8 w-7 sm:w-auto p-0 sm:px-3" onClick={() => setCreateAlbumOpen(true)}>
              <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4 sm:mr-1.5" />
              <span className="hidden sm:inline">新建图集</span>
            </Button>
          </div>
        </div>
      </div>

      <div ref={containerRef} className="flex-1 overflow-auto px-1 sm:px-6 py-2 sm:py-6 pb-28 md:pb-4 space-y-4 sm:space-y-8" onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('[data-card],.group')) return
        e.preventDefault()
        setAreaMenu({ x: e.clientX, y: e.clientY })
      }}>
        {/* Albums */}
        {albums.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold">图集 ({albums.length})</h2>
              <FilterBar
                sortField={albumStore.sort}
                sortOptions={[
                  { value: 'created_at', label: '最新创建' },
                  { value: 'avg_rating', label: '评分最高' },
                  { value: 'name', label: '名称 A-Z' },
                ]}
                onSortChange={(v) => { albumStore.setSort(v as any); if (personId) fetchAlbumsByPerson(personId) }}
                ratingFilter={albumStore.filterRating}
                onRatingFilterChange={(v) => { albumStore.setFilterRating(v || undefined); if (personId) fetchAlbumsByPerson(personId) }}
              />
            </div>
            <div style={gridStyle}>
              {albums.map((a) => <AlbumCard key={a.id} album={a} compact={compact} />)}
            </div>
          </section>
        )}

        {/* Loose media */}
        {looseItems.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold">散图 ({looseItems.length})</h2>
              <FilterBar
                sortField={sort}
                sortOptions={[
                  { value: 'created_at', label: '最新添加' },
                  { value: 'rating', label: '评分最高' },
                ]}
                onSortChange={(v) => { setSort(v as any); if (personId) fetchLoose(personId) }}
                ratingFilter={filterRating}
                onRatingFilterChange={(v) => { setFilterRating(v || undefined); if (personId) fetchLoose(personId) }}
                sourceType={sourceType}
                onSourceTypeChange={(v) => { setSourceType(v || undefined); if (personId) fetchLoose(personId) }}
              />
            </div>
            <div style={gridStyle}>
              {looseItems.map((m, i) => (
                <MediaCard
                  key={m.id}
                  item={m}
                  personId={personId}
                  compact={compact}
                  onCoverSet={handleRefresh}
                  onClick={() => openLightbox(looseItems, i, { personId, onCoverSet: handleRefresh })}
                  selectable={multiSelectMode}
                  selected={selectedIds.has(m.id)}
                  onToggleSelect={toggleSelection}
                  extraMenuItems={<>
                    {m.media_type === 'image' && (
                      <MenuItem icon={<ZoomIn className="w-3.5 h-3.5" />} label="高清放大" onClick={() => setUpscaleMedia(m)} />
                    )}
                    {m.media_type === 'image' && (
                      <MenuItem icon={<Repeat className="w-3.5 h-3.5" />} label="换脸" onClick={() => setFaceSwapMedia(m)} />
                    )}
                    {m.media_type === 'image' && (
                      <MenuItem icon={<Paintbrush className="w-3.5 h-3.5" />} label="局部修复" onClick={() => setInpaintMedia(m)} />
                    )}
                    <MenuItem icon={<Briefcase className="w-3.5 h-3.5" />} label="加入工作区" onClick={async () => {
                      try { await useWorkspaceStore.getState().addItem(m.id); toast({ title: '已加入工作区' }) }
                      catch (err: any) { toast({ title: err.message || '添加失败', variant: 'destructive' }) }
                    }} />
                    <MenuItem icon={<FolderInput className="w-3.5 h-3.5" />} label="移动到图集" onClick={() => handleMoveToAlbum(m)} />
                    <MenuItem icon={<FolderOpen className="w-3.5 h-3.5" />} label="在资源管理器中显示" onClick={() => handleShowInExplorer(m)} />
                  </>}
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

      {/* Area context menu */}
      {areaMenu && (
        <ContextMenuPortal position={areaMenu} onClose={() => setAreaMenu(null)}>
          <MenuItem icon={<Edit2 className="w-3.5 h-3.5" />} label="重命名人物" onClick={() => {
            setAreaMenu(null)
            setRenameName(currentPerson?.name || '')
            setRenameOpen(true)
          }} />
          <MenuItem icon={<Download className="w-3.5 h-3.5" />} label="导入" onClick={() => { setAreaMenu(null); setImportOpen(true) }} />
          <MenuItem icon={<Plus className="w-3.5 h-3.5" />} label="新建图集" onClick={() => { setAreaMenu(null); setCreateAlbumOpen(true) }} />
          <MenuSeparator />
          <MenuItem icon={<Trash2 className="w-3.5 h-3.5" />} label="清理低分图" onClick={() => { setAreaMenu(null); setCleanupOpen(true) }} />
        </ContextMenuPortal>
      )}

      {/* Rename person dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>重命名人物</DialogTitle></DialogHeader>
          <Input
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && renameName.trim() && personId) {
                updatePerson(personId, { name: renameName.trim() }).then(() => {
                  setRenameOpen(false)
                  fetchPerson(personId)
                })
              }
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>取消</Button>
            <Button onClick={() => {
              if (renameName.trim() && personId) {
                updatePerson(personId, { name: renameName.trim() }).then(() => {
                  setRenameOpen(false)
                  fetchPerson(personId)
                })
              }
            }}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch cleanup dialog */}
      <Dialog open={cleanupOpen} onOpenChange={setCleanupOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>清理低分图</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">删除评分低于或等于指定星级的所有图片</p>
            <div>
              <label className="text-sm font-medium mb-1.5 block">阈值 (星)</label>
              <div className="flex gap-2">
                {[1, 2, 3].map(v => (
                  <Button
                    key={v}
                    variant={cleanupThreshold === v ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setCleanupThreshold(v)}
                  >
                    {'★'.repeat(v)} {v}星及以下
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCleanupOpen(false)}>取消</Button>
            <Button variant="destructive" onClick={handleBatchCleanup}>确认删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LightBox onShowInExplorer={handleShowInExplorer} onMoveToAlbum={handleMoveToAlbum} onUpscale={(m) => setUpscaleMedia(m)} onFaceSwap={(m) => setFaceSwapMedia(m)} onInpaint={(m) => setInpaintMedia(m)} onScreenshotUpscale={(m) => setUpscaleMedia(m)} />
      <MoveToAlbumDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        mediaIds={moveTarget}
        personId={personId}
        onComplete={handleRefresh}
      />
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
      <SelectionToolbar
        personId={personId}
        onMoveToAlbum={(ids) => { setMoveTarget(ids); setMoveOpen(true) }}
        onRefresh={handleRefresh}
      />
      <UpscaleDrawer
        open={!!upscaleMedia}
        onOpenChange={(v) => { if (!v) setUpscaleMedia(null) }}
        media={upscaleMedia}
      />
      <FaceSwapDrawer
        open={!!faceSwapMedia}
        onOpenChange={(v) => { if (!v) setFaceSwapMedia(null) }}
        media={faceSwapMedia}
      />
      <MaskEditor
        open={!!inpaintMedia}
        onClose={() => setInpaintMedia(null)}
        media={inpaintMedia}
      />
    </div>
  )
}
