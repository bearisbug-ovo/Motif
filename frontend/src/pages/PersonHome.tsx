import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Download, Plus, Images, Edit2, FolderInput, FolderOpen, Shuffle, Briefcase, Trash2, ArrowRightLeft, FolderX, RefreshCw } from 'lucide-react'
import { usePersonStore } from '@/stores/person'
import { useAlbumStore } from '@/stores/album'
import { useTagStore } from '@/stores/tag'
import { albumsApi } from '@/api/albums'
import { useMediaStore, setOnRatingChange, setOnDelete } from '@/stores/media'
import { useLightboxStore } from '@/stores/lightbox'
import { AlbumCard } from '@/components/AlbumCard'
import { MediaCard } from '@/components/MediaCard'
import { ImportDialog } from '@/components/ImportDialog'
import { MoveToAlbumDialog } from '@/components/MoveToAlbumDialog'
import { MoveToPersonDialog } from '@/components/MoveToPersonDialog'
import { SelectionToolbar } from '@/components/SelectionToolbar'
import { BatchAiDialog } from '@/components/BatchAiDialog'
import { AiMediaSubMenu } from '@/components/AiContextMenu'
import { WorkflowRunDialog } from '@/components/WorkflowRunDialog'
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
import { confirm } from '@/components/ConfirmDialog'
import { useGridZoom, isMobile } from '@/hooks/useGridZoom'
import { useMissingFiles } from '@/hooks/useMissingFiles'
import { EmptyState } from '@/components/Skeleton'
import { TagEditorDialog } from '@/components/TagEditor'
import { useDownloadStore } from '@/stores/download'
import type { ScanJobStatus } from '@/api/downloads'
import type { PersonAccount } from '@/api/persons'

export function PersonHome() {
  const { personId } = useParams<{ personId: string }>()
  const navigate = useNavigate()
  const { currentPerson, fetchPerson, updatePerson, deletePerson } = usePersonStore()
  const albumStore = useAlbumStore()
  const { albums, fetchAlbumsByPerson, createAlbum } = albumStore
  const { tags, fetchTags } = useTagStore()
  const [tagEditOpen, setTagEditOpen] = useState(false)
  const { looseItems, looseTotal, fetchLoose, openLightbox, multiSelectMode, setMultiSelectMode, selectedIds, toggleSelection, sort, filterRating, sourceType, mediaType, setSort, setFilterRating, setSourceType, setMediaType, resetFilters: resetMediaFilters } = useMediaStore()
  const [importOpen, setImportOpen] = useState(false)
  const [createAlbumOpen, setCreateAlbumOpen] = useState(false)
  const [newAlbumName, setNewAlbumName] = useState('')
  const [areaMenu, setAreaMenu] = useState<{ x: number; y: number } | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameName, setRenameName] = useState('')
  const [moveTarget, setMoveTarget] = useState<string[]>([])
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveToPersonTarget, setMoveToPersonTarget] = useState<string[]>([])
  const [moveToPersonOpen, setMoveToPersonOpen] = useState(false)
  const [aiTarget, setAiTarget] = useState<{ category: string; media: MediaItem } | null>(null)
  const [cleanupOpen, setCleanupOpen] = useState(false)
  const [cleanupThreshold, setCleanupThreshold] = useState(2)
  const [deletePersonOpen, setDeletePersonOpen] = useState(false)
  const [deleteMode, setDeleteMode] = useState<'person_only' | 'person_and_albums' | 'all'>('person_only')
  const [batchAiState, setBatchAiState] = useState<{ albumId: string; albumName: string; category: string } | null>(null)
  const [batchAiMediaIds, setBatchAiMediaIds] = useState<string[] | undefined>()
  const [importAlbumId, setImportAlbumId] = useState<string | undefined>()
  const [syncMenuAccount, setSyncMenuAccount] = useState<PersonAccount | null>(null)
  const { scanJob, scanning, startScan, confirmBatch, cancelScan, clearScanJob } = useDownloadStore()
  const { value: cols, containerRef, gridStyle } = useGridZoom({ pageKey: 'person-home' })
  const compact = cols >= (isMobile ? 4 : 10)
  const missingFiles = useMissingFiles(looseItems)

  const handleShowInExplorer = useCallback((item: MediaItem) => {
    mediaApi.showInExplorer(item.id).catch(() => toast({ title: '无法打开', variant: 'destructive' }))
  }, [])

  const handleMoveToAlbum = useCallback((item: MediaItem) => {
    setMoveTarget([item.id])
    setMoveOpen(true)
  }, [])

  const handleMoveToPerson = useCallback((item: MediaItem) => {
    setMoveToPersonTarget([item.id])
    setMoveToPersonOpen(true)
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
        useLightboxStore.setState({ localItems: re, localIndex: 0, currentItem: re[0] || null, chainTree: null, chainFlat: [], chainIndex: -1 })
      }
      openLightbox(shuffled, 0, {
        personId,
        onCoverSet: handleRefresh,
        exploreMode: true,
        onReshuffle,
      })
    } catch {}
  }, [personId, openLightbox, handleRefresh])

  const handleSyncAccount = useCallback(async (account: PersonAccount) => {
    try {
      await startScan(account.platform, account.username, account.display_name || undefined)
    } catch (e: any) {
      toast({ title: '扫描失败', description: e.message, variant: 'destructive' })
    }
  }, [startScan])

  const handleSyncConfirm = useCallback(async () => {
    if (!scanJob || !personId) return
    try {
      await confirmBatch({
        job_id: scanJob.job_id,
        person_id: personId,
        album_mode: 'per_note',
        remember_account: true,
      })
      toast({ title: '开始批量下载', description: `共 ${scanJob.total_notes} 个笔记` })
    } catch (e: any) {
      toast({ title: '批量下载失败', description: e.message, variant: 'destructive' })
    }
  }, [scanJob, personId, confirmBatch])

  const handleSyncCancel = useCallback(async () => {
    try {
      await cancelScan()
    } catch {}
    setSyncMenuAccount(null)
  }, [cancelScan])

  useEffect(() => {
    if (!personId) return
    // Only clear data when switching to a DIFFERENT person (not on re-entry/refresh)
    const { currentPerson } = usePersonStore.getState()
    if (!currentPerson || currentPerson.id !== personId) {
      useAlbumStore.setState({ albums: [], loading: true })
      useMediaStore.setState({ looseItems: [], looseTotal: 0, loading: true })
    }
    albumStore.resetFilters()
    resetMediaFilters('person-loose')
    fetchPerson(personId)
    fetchAlbumsByPerson(personId)
    fetchLoose(personId)
    fetchTags()
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

  useEffect(() => {
    setOnDelete(() => handleRefreshRatings())
    return () => setOnDelete(null)
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
    if (!await confirm({ title: `确定要删除 ${lowScoreIds.length} 张 ${cleanupThreshold} 星及以下的图片吗？` })) return
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

  if (!currentPerson || currentPerson.id !== personId) return (
    <div className="flex-1 overflow-auto px-1 sm:px-6 py-2 sm:py-4" />
  )

  return (
    <div data-testid="person-home-page" className="flex flex-col h-full overflow-auto">
      {/* Hero */}
      <div className="relative bg-gradient-to-b from-card to-background px-3 sm:px-6 pt-3 sm:pt-4 pb-4 sm:pb-6 border-b border-border" onContextMenu={(e) => {
        e.preventDefault()
        setAreaMenu({ x: e.clientX, y: e.clientY })
      }}>
        <div className="flex items-center gap-2 mb-2 sm:mb-4">
          <Button variant="ghost" size="sm" className="h-7 sm:h-8" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-4 h-4 mr-1" />
            <span className="hidden sm:inline">返回</span>
          </Button>
        </div>
        <div className="flex items-start gap-3 sm:gap-6">
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
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h1 className="text-lg sm:text-2xl font-bold truncate">{currentPerson.name}</h1>
                <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                  {currentPerson.media_count} 张 · {currentPerson.album_count} 图集
                </p>
                {currentPerson.tags && currentPerson.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {currentPerson.tags.map((t) => (
                      <span
                        key={t.id}
                        className="inline-flex items-center px-2 py-0.5 text-[11px] rounded-full bg-primary/10 text-primary cursor-pointer hover:bg-primary/20 transition-colors"
                        onClick={(e) => { e.stopPropagation(); setTagEditOpen(true) }}
                      >
                        {t.name}
                      </span>
                    ))}
                    <button
                      className="inline-flex items-center px-1.5 py-0.5 text-[11px] rounded-full border border-dashed border-muted-foreground/30 text-muted-foreground hover:bg-accent transition-colors"
                      onClick={() => setTagEditOpen(true)}
                    >+</button>
                  </div>
                )}
                {(!currentPerson.tags || currentPerson.tags.length === 0) && (
                  <button
                    className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 text-[11px] rounded-full border border-dashed border-muted-foreground/30 text-muted-foreground hover:bg-accent transition-colors"
                    onClick={() => setTagEditOpen(true)}
                  >
                    + 标签
                  </button>
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
            {currentPerson.accounts && currentPerson.accounts.length > 0 && (
              <div className="flex flex-wrap gap-1 sm:gap-1.5 mt-1.5 sm:mt-2">
                {currentPerson.accounts.map((acct) => (
                  <AccountBadge
                    key={acct.id}
                    account={acct}
                    scanning={scanning && syncMenuAccount?.id === acct.id}
                    onSync={() => {
                      setSyncMenuAccount(acct)
                      handleSyncAccount(acct)
                    }}
                  />
                ))}
              </div>
            )}
            {currentPerson.avg_rating !== null && (
              <div className="mt-1 sm:mt-2 flex items-center">
                <StarRating value={Math.round(currentPerson.avg_rating)} readonly size="md" />
                <span className="text-xs text-muted-foreground ml-1.5 sm:ml-2">
                  {currentPerson.avg_rating.toFixed(1)} ({currentPerson.rated_count})
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div ref={containerRef} className="flex-1 overflow-auto px-1 sm:px-6 py-2 sm:py-6 pb-28 md:pb-4 space-y-4 sm:space-y-8" onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('[data-card],[data-media-id],[data-testid="person-card"]')) return
        e.preventDefault()
        setAreaMenu({ x: e.clientX, y: e.clientY })
      }}>
        {/* Scan job progress — only show if the job belongs to this person's linked accounts */}
        {scanJob && currentPerson?.accounts?.some(a => a.platform === scanJob.platform && a.username === scanJob.username) && (
          <SyncProgressCard
            scanJob={scanJob}
            scanning={scanning}
            onConfirm={handleSyncConfirm}
            onCancel={handleSyncCancel}
            onClear={clearScanJob}
            onRefresh={handleRefresh}
          />
        )}

        {/* Albums */}
        {albums.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold">图集 ({albums.length})</h2>
              <FilterBar
                sortField={albumStore.sort}
                sortOptions={[
                  { value: 'created_at:desc', label: '最新创建' },
                  { value: 'created_at:asc',  label: '最早创建' },
                  { value: 'avg_rating:desc', label: '评分最高' },
                  { value: 'avg_rating:asc',  label: '评分最低' },
                  { value: 'name:asc',        label: '名称 A→Z' },
                  { value: 'name:desc',       label: '名称 Z→A' },
                ]}
                onSortChange={(v) => { albumStore.setSort(v as any); if (personId) fetchAlbumsByPerson(personId) }}
                ratingFilter={albumStore.filterRating}
                onRatingFilterChange={(v) => { albumStore.setFilterRating(v || undefined); if (personId) fetchAlbumsByPerson(personId) }}
                tags={tags}
                selectedTagIds={albumStore.filterTagIds}
                onTagChange={(ids) => { albumStore.setFilterTagIds(ids); if (personId) setTimeout(() => fetchAlbumsByPerson(personId), 0) }}
              />
            </div>
            <div style={gridStyle}>
              {albums.map((a, i) => (
                <AlbumCard
                  key={a.id}
                  album={a}
                  compact={compact}
                  animIndex={i}
                  onImport={() => { setImportAlbumId(a.id); setImportOpen(true) }}
                  onBatchAi={(cat) => { setBatchAiMediaIds(undefined); setBatchAiState({ albumId: a.id, albumName: a.name, category: cat }) }}
                />
              ))}
            </div>
          </section>
        )}

        {/* Loose media */}
        {looseTotal > 0 && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold">未分类 ({looseItems.length}{looseItems.length !== looseTotal ? ` / ${looseTotal}` : ''})</h2>
              <FilterBar
                sortField={sort}
                sortOptions={[
                  { value: 'created_at:desc', label: '最新添加' },
                  { value: 'created_at:asc',  label: '最早添加' },
                  { value: 'rating:desc',     label: '评分最高' },
                  { value: 'rating:asc',      label: '评分最低' },
                ]}
                onSortChange={(v) => { setSort(v as any); if (personId) fetchLoose(personId, { sort: v }) }}
                ratingFilter={filterRating}
                onRatingFilterChange={(v) => { const val = v || undefined; setFilterRating(val); if (personId) fetchLoose(personId, { filterRating: val }) }}
                sourceType={sourceType}
                onSourceTypeChange={(v) => { const val = v || undefined; setSourceType(val); if (personId) fetchLoose(personId, { sourceType: val }) }}
                mediaType={mediaType}
                onMediaTypeChange={(v) => { const val = v || undefined; setMediaType(val); if (personId) fetchLoose(personId, { mediaType: val }) }}
              />
            </div>
            {looseItems.length > 0 ? (
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
                    missingFile={missingFiles.has(m.id)}
                    animIndex={i}
                    extraMenuItems={<>
                      <AiMediaSubMenu item={m} onAction={(cat) => setAiTarget({ category: cat, media: m })} />
                      <MenuItem icon={<Briefcase className="w-3.5 h-3.5" />} label="加入工作区" onClick={async () => {
                        try { await useWorkspaceStore.getState().addItem(m.id); toast({ title: '已加入工作区' }) }
                        catch (err: any) { toast({ title: err.message || '添加失败', variant: 'destructive' }) }
                      }} />
                      <MenuItem icon={<FolderInput className="w-3.5 h-3.5" />} label="移动到图集" onClick={() => handleMoveToAlbum(m)} />
                      <MenuItem icon={<ArrowRightLeft className="w-3.5 h-3.5" />} label="移动到其他人物" onClick={() => handleMoveToPerson(m)} />
                      <MenuItem icon={<FolderOpen className="w-3.5 h-3.5" />} label="在资源管理器中显示" onClick={() => handleShowInExplorer(m)} />
                    </>}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground text-sm">
                当前筛选条件下无内容
              </div>
            )}
          </section>
        )}

        {albums.length === 0 && looseTotal === 0 && (
          <EmptyState
            icon={Images}
            title="还没有图片"
            description="点击「导入」添加图片到此人物"
            action={
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <Download className="w-4 h-4 mr-1.5" />
                导入图片
              </Button>
            }
          />
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
          <MenuItem icon={<FolderX className="w-3.5 h-3.5" />} label="清理空图集" onClick={async () => {
            setAreaMenu(null)
            if (!await confirm({ title: '确定要删除此人物下所有空图集吗？' })) return
            try {
              const result = await albumsApi.cleanupEmpty(personId)
              if (result.deleted_count === 0) {
                toast({ title: '没有空图集需要清理' })
              } else {
                toast({ title: `已清理 ${result.deleted_count} 个空图集` })
                handleRefresh()
              }
            } catch (err: any) {
              toast({ title: '清理失败', description: err.message, variant: 'destructive' })
            }
          }} />
          <MenuItem icon={<Trash2 className="w-3.5 h-3.5" />} label="清理低分图" onClick={() => { setAreaMenu(null); setCleanupOpen(true) }} />
          <MenuItem icon={<Trash2 className="w-3.5 h-3.5" />} label="删除人物" onClick={() => { setAreaMenu(null); setDeletePersonOpen(true) }} destructive />
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

      {/* Delete person dialog */}
      <Dialog open={deletePersonOpen} onOpenChange={setDeletePersonOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>删除人物 "{currentPerson?.name}"</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {(['person_only', 'person_and_albums', 'all'] as const).map((mode) => (
              <label key={mode} className="flex items-start gap-3 cursor-pointer p-3 rounded border border-border hover:bg-accent">
                <input type="radio" name="delete-mode" value={mode} checked={deleteMode === mode} onChange={() => setDeleteMode(mode)} className="mt-0.5" />
                <div>
                  <div className="text-sm font-medium">
                    {mode === 'person_only' ? '仅删除人物' : mode === 'person_and_albums' ? '删除人物和图集' : '删除全部（含图片）'}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {mode === 'person_only' ? '图集和图片保留，仅解除关联' : mode === 'person_and_albums' ? '删除图集，图片移入未分类' : '所有图片移入回收站'}
                  </div>
                </div>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletePersonOpen(false)}>取消</Button>
            <Button variant="destructive" onClick={async () => {
              if (!personId) return
              await deletePerson(personId, deleteMode)
              setDeletePersonOpen(false)
              navigate('/')
            }}>确认删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LightBox onShowInExplorer={handleShowInExplorer} onMoveToAlbum={handleMoveToAlbum} onMoveToPerson={handleMoveToPerson} onAiAction={(cat, m) => setAiTarget({ category: cat, media: m })} />
      <MoveToAlbumDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        mediaIds={moveTarget}
        personId={personId}
        onComplete={handleRefresh}
      />
      <MoveToPersonDialog
        open={moveToPersonOpen}
        onOpenChange={setMoveToPersonOpen}
        mediaIds={moveToPersonTarget}
        currentPersonId={personId}
        onComplete={handleRefresh}
      />
      <ImportDialog
        open={importOpen}
        onOpenChange={(v) => { setImportOpen(v); if (!v) setImportAlbumId(undefined) }}
        defaultPersonId={personId}
        defaultAlbumId={importAlbumId}
        onComplete={handleRefresh}
      />
      <BatchAiDialog
        open={!!batchAiState || !!batchAiMediaIds}
        onOpenChange={(v) => { if (!v) { setBatchAiState(null); setBatchAiMediaIds(undefined) } }}
        mediaIds={batchAiMediaIds}
        albumId={batchAiState?.albumId}
        albumName={batchAiState?.albumName}
        personId={personId}
        defaultCategory={batchAiState?.category}
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
      <TagEditorDialog
        open={tagEditOpen}
        onOpenChange={setTagEditOpen}
        selectedTagIds={(currentPerson?.tags || []).map(t => t.id)}
        onToggle={async (tagId, selected) => {
          if (!personId) return
          const currentIds = (currentPerson?.tags || []).map(t => t.id)
          const newIds = selected ? [...currentIds, tagId] : currentIds.filter(id => id !== tagId)
          await updatePerson(personId, { tag_ids: newIds })
          fetchPerson(personId)
          fetchTags()
        }}
      />
      <SelectionToolbar
        personId={personId}
        scope="loose"
        onMoveToAlbum={(ids) => { setMoveTarget(ids); setMoveOpen(true) }}
        onMoveToPerson={(ids) => { setMoveToPersonTarget(ids); setMoveToPersonOpen(true) }}
        onBatchAi={(ids) => { setBatchAiMediaIds(ids); setBatchAiState(null) }}
        onRefresh={handleRefresh}
      />
      <WorkflowRunDialog
        open={!!aiTarget}
        onOpenChange={(v) => { if (!v) setAiTarget(null) }}
        category={aiTarget?.category || ''}
        sourceMedia={aiTarget?.media || null}
      />
    </div>
  )
}

// ── Account Badge ───────────────────────────────────────────────────────────

const PLATFORM_LABELS: Record<string, string> = {
  xiaohongshu: '小红书',
  douyin: '抖音',
  bilibili: 'B站',
  twitter: 'X',
  telegram: 'TG',
}

function AccountBadge({ account, scanning, onSync }: {
  account: PersonAccount
  scanning: boolean
  onSync: () => void
}) {
  return (
    <button
      className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full border border-border bg-muted/50 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      onClick={onSync}
      title={`同步 ${account.display_name || account.username} 的全部图文`}
    >
      <span className="font-medium text-primary/80">{PLATFORM_LABELS[account.platform] || account.platform}</span>
      <span className="truncate max-w-[100px]">{account.display_name || account.username}</span>
      {scanning ? (
        <RefreshCw className="w-3 h-3 animate-spin shrink-0" />
      ) : (
        <RefreshCw className="w-3 h-3 opacity-0 group-hover:opacity-100 shrink-0" />
      )}
    </button>
  )
}

// ── Sync Progress Card ──────────────────────────────────────────────────────

function SyncProgressCard({ scanJob, scanning, onConfirm, onCancel, onClear, onRefresh }: {
  scanJob: ScanJobStatus
  scanning: boolean
  onConfirm: () => void
  onCancel: () => void
  onClear: () => void
  onRefresh: () => void
}) {
  const isScanning = scanJob.status === 'scanning'
  const isScanComplete = scanJob.status === 'scan_complete'
  const isDownloading = scanJob.status === 'downloading'
  const isCompleted = scanJob.status === 'completed'
  const isFailed = scanJob.status === 'failed'
  const isCancelled = scanJob.status === 'cancelled'

  // Auto-refresh page data when download completes
  useEffect(() => {
    if (isCompleted) onRefresh()
  }, [isCompleted]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-0 rounded-lg border border-border bg-card p-3 sm:p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">
          {isScanning && '正在扫描账号笔记...'}
          {isScanComplete && `扫描完成 · ${scanJob.total_notes} 个新笔记，${scanJob.total_media} 张图片${scanJob.skipped_notes > 0 ? `（已跳过 ${scanJob.skipped_notes} 个已下载）` : ''}`}
          {isDownloading && '正在批量下载...'}
          {isCompleted && '批量下载完成'}
          {isFailed && '扫描失败'}
          {isCancelled && '已取消'}
        </h3>
        {(isCompleted || isFailed || isCancelled) && (
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onClear}>关闭</Button>
        )}
      </div>

      {isScanning && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          正在获取笔记列表...
        </div>
      )}

      {isScanComplete && scanJob.total_notes === 0 && (
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">所有笔记都已下载过，没有新内容</p>
          <Button variant="outline" size="sm" onClick={onClear}>关闭</Button>
        </div>
      )}

      {isScanComplete && scanJob.total_notes > 0 && (
        <div className="flex gap-2">
          <Button size="sm" className="gap-1.5" onClick={onConfirm}>
            <Download className="w-3.5 h-3.5" />
            每个笔记建一个图集，开始下载
          </Button>
          <Button variant="outline" size="sm" onClick={onCancel}>取消</Button>
        </div>
      )}

      {isDownloading && (
        <div className="space-y-2">
          <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-primary h-full rounded-full transition-all duration-300"
              style={{ width: `${scanJob.total_notes > 0 ? ((scanJob.completed_notes + scanJob.failed_notes) / scanJob.total_notes) * 100 : 0}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{scanJob.completed_notes + scanJob.failed_notes} / {scanJob.total_notes} 笔记 · {scanJob.downloaded_media} 张图片</span>
            <Button variant="ghost" size="sm" className="h-5 px-1.5 text-xs" onClick={onCancel}>取消</Button>
          </div>
        </div>
      )}

      {isCompleted && (
        <p className="text-xs text-muted-foreground">
          已下载 {scanJob.completed_notes} 个笔记，{scanJob.downloaded_media} 张图片
          {scanJob.failed_notes > 0 && `（${scanJob.failed_notes} 个失败）`}
        </p>
      )}

      {isFailed && (
        <p className="text-xs text-destructive">{scanJob.error || '未知错误'}</p>
      )}
    </div>
  )
}
