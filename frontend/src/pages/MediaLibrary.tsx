import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Download, Shuffle, Users, Briefcase, FolderInput, FolderOpen, Trash } from 'lucide-react'
import { usePersonStore } from '@/stores/person'
import { useAlbumStore } from '@/stores/album'
import { useTagStore } from '@/stores/tag'
import { albumsApi } from '@/api/albums'
import { PersonCard } from '@/components/PersonCard'
import { MediaCard } from '@/components/MediaCard'
import { FilterBar } from '@/components/FilterBar'
import { ImportDialog } from '@/components/ImportDialog'
import { ContextMenuPortal, MenuItem } from '@/components/ContextMenuPortal'
import { AiMediaSubMenu } from '@/components/AiContextMenu'
import { LightBox } from '@/components/LightBox'
import { MoveToAlbumDialog } from '@/components/MoveToAlbumDialog'
import { WorkflowRunDialog } from '@/components/WorkflowRunDialog'
import { useMediaStore, setOnDelete } from '@/stores/media'
import { useLightboxStore } from '@/stores/lightbox'
import { useWorkspaceStore } from '@/stores/workspace'
import { mediaApi, MediaItem } from '@/api/media'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'
import { confirm } from '@/components/ConfirmDialog'
import { useGridZoom, isMobile } from '@/hooks/useGridZoom'
import { EmptyState } from '@/components/Skeleton'

const SORT_OPTIONS = [
  { value: 'created_at:desc', label: '最新创建' },
  { value: 'created_at:asc',  label: '最早创建' },
  { value: 'avg_rating:desc', label: '评分最高' },
  { value: 'avg_rating:asc',  label: '评分最低' },
  { value: 'name:asc',        label: '名称 A→Z' },
  { value: 'name:desc',       label: '名称 Z→A' },
]

export function MediaLibrary() {
  const navigate = useNavigate()
  const { persons, loading, sort, filterRating, filterTagIds, fetchPersons, createPerson, setSort, setFilterRating, setFilterTagIds, resetFilters } = usePersonStore()
  const { tags, fetchTags } = useTagStore()
  const { createAlbum } = useAlbumStore()
  const { openLightbox } = useMediaStore()
  const [importOpen, setImportOpen] = useState(false)
  const [importPersonId, setImportPersonId] = useState<string | undefined>()
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [areaMenu, setAreaMenu] = useState<{ x: number; y: number } | null>(null)
  const [uncategorized, setUncategorized] = useState<MediaItem[]>([])
  const [aiTarget, setAiTarget] = useState<{ category: string; media: MediaItem } | null>(null)
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveTarget, setMoveTarget] = useState<string[]>([])
  const [createAlbumOpen, setCreateAlbumOpen] = useState(false)
  const [createAlbumPersonId, setCreateAlbumPersonId] = useState<string>('')
  const [newAlbumName, setNewAlbumName] = useState('')
  const [cleanupOpen, setCleanupOpen] = useState(false)
  const [cleanupPersonId, setCleanupPersonId] = useState<string>('')
  const [cleanupThreshold, setCleanupThreshold] = useState(2)
  const { value: cols, containerRef, gridStyle } = useGridZoom({ pageKey: 'media-library' })

  const fetchUncategorized = useCallback(() => {
    mediaApi.listUncategorized().then(setUncategorized).catch(() => {})
  }, [])

  const handleShowInExplorer = useCallback((item: MediaItem) => {
    mediaApi.showInExplorer(item.id).catch(() => toast({ title: '无法打开', variant: 'destructive' }))
  }, [])

  const handleMoveToAlbum = useCallback((item: MediaItem) => {
    setMoveTarget([item.id])
    setMoveOpen(true)
  }, [])

  useEffect(() => { resetFilters(); fetchPersons(); fetchUncategorized(); fetchTags() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh on media delete (uncategorized local state + person stats)
  useEffect(() => {
    setOnDelete((ids) => {
      setUncategorized((prev) => prev.filter((m) => !ids.includes(m.id)))
      fetchPersons()
    })
    return () => setOnDelete(null)
  }, [fetchPersons])

  const handleExplore = async () => {
    try {
      const items = await mediaApi.explore({ limit: 100 })
      if (items.length === 0) return
      const onReshuffle = async () => {
        const fresh = await mediaApi.explore({ limit: 100 })
        useLightboxStore.setState({ localItems: fresh, localIndex: 0, currentItem: fresh[0] || null, chainTree: null, chainFlat: [], chainIndex: -1 })
      }
      openLightbox(items, 0, { exploreMode: true, onReshuffle })
    } catch {}
  }

  const handleCreate = async () => {
    if (!newName.trim()) return
    try {
      await createPerson(newName.trim())
      setNewName('')
      setCreateOpen(false)
      toast({ title: '人物已创建' })
    } catch (err: any) {
      toast({ title: '创建失败', description: err.message, variant: 'destructive' })
    }
  }

  return (
    <div data-testid="media-library-page" className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 sm:px-6 h-12 sm:h-14 border-b border-border shrink-0">
        <h1 data-testid="page-title" className="text-base sm:text-lg font-semibold shrink-0">人物库</h1>
        <div className="flex items-center gap-1 sm:gap-2">
          <Button variant="outline" size="sm" className="h-8 w-8 p-0 sm:w-auto sm:px-3" onClick={handleExplore}>
            <Shuffle className="w-4 h-4 sm:mr-1.5" />
            <span className="hidden sm:inline">随机浏览</span>
          </Button>
          <Button variant="outline" size="sm" className="h-8 w-8 p-0 sm:w-auto sm:px-3" onClick={() => setImportOpen(true)}>
            <Download className="w-4 h-4 sm:mr-1.5" />
            <span className="hidden sm:inline">导入图片</span>
          </Button>
          <Button size="sm" className="h-8 w-8 p-0 sm:w-auto sm:px-3" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 sm:mr-1.5" />
            <span className="hidden sm:inline">新建人物</span>
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="px-3 sm:px-6 py-2 sm:py-3 border-b border-border shrink-0">
        <FilterBar
          sortField={sort}
          sortOptions={SORT_OPTIONS}
          onSortChange={(v) => { setSort(v as any); fetchPersons() }}
          ratingFilter={filterRating}
          onRatingFilterChange={(v) => { setFilterRating(v || undefined); fetchPersons() }}
          tags={tags}
          selectedTagIds={filterTagIds}
          onTagChange={(ids) => { setFilterTagIds(ids); setTimeout(fetchPersons, 0) }}
        />
      </div>

      {/* Grid */}
      <div ref={containerRef} className="flex-1 overflow-auto px-1 sm:px-6 py-2 sm:py-4 pb-28 md:pb-4" onContextMenu={(e) => {
        // Only fire on empty area (not on cards)
        if ((e.target as HTMLElement).closest('[data-card]')) return
        e.preventDefault()
        setAreaMenu({ x: e.clientX, y: e.clientY })
      }}>
        {persons.length === 0 && uncategorized.length === 0 && !loading ? (
          <EmptyState
            icon={Users}
            title="还没有任何人物"
            description="创建人物或导入图片开始使用"
            action={
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="w-4 h-4 mr-1.5" />
                创建第一个人物
              </Button>
            }
          />
        ) : (
          <>
            {persons.length > 0 && (
              <div data-testid="person-grid" style={gridStyle}>
                {persons.map((p, i) => (
                  <PersonCard
                    key={p.id}
                    person={p}
                    compact={cols >= (isMobile ? 4 : 10)}
                    animIndex={i}
                    onImport={() => { setImportPersonId(p.id); setImportOpen(true) }}
                    onCreateAlbum={() => { setCreateAlbumPersonId(p.id); setNewAlbumName(''); setCreateAlbumOpen(true) }}
                    onCleanupLowRated={() => { setCleanupPersonId(p.id); setCleanupOpen(true) }}
                    onCleanupEmptyAlbums={async () => {
                      if (!await confirm({ title: `确定要删除"${p.name}"下所有空图集吗？` })) return
                      try {
                        const result = await albumsApi.cleanupEmpty(p.id)
                        if (result.deleted_count === 0) {
                          toast({ title: '没有空图集需要清理' })
                        } else {
                          toast({ title: `已清理 ${result.deleted_count} 个空图集` })
                          fetchPersons()
                        }
                      } catch (err: any) {
                        toast({ title: '清理失败', description: err.message, variant: 'destructive' })
                      }
                    }}
                  />
                ))}
              </div>
            )}
            {uncategorized.length > 0 && (
              <section className={persons.length > 0 ? 'mt-6' : ''}>
                <h2 className="text-base font-semibold mb-3 px-1">未分类 ({uncategorized.length})</h2>
                <div style={gridStyle}>
                  {uncategorized.map((m, i) => (
                    <MediaCard
                      key={m.id}
                      item={m}
                      onClick={() => openLightbox(uncategorized, i)}
                      animIndex={i}
                      extraMenuItems={<>
                        <AiMediaSubMenu item={m} onAction={(cat) => setAiTarget({ category: cat, media: m })} />
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
          </>
        )}
      </div>

      {/* Area context menu */}
      {areaMenu && (
        <ContextMenuPortal position={areaMenu} onClose={() => setAreaMenu(null)}>
          <MenuItem icon={<Plus className="w-3.5 h-3.5" />} label="新建人物" onClick={() => { setAreaMenu(null); setCreateOpen(true) }} />
          <MenuItem icon={<Download className="w-3.5 h-3.5" />} label="导入图片" onClick={() => { setAreaMenu(null); setImportOpen(true) }} />
          <MenuItem icon={<Trash className="w-3.5 h-3.5" />} label="清理空图集" onClick={async () => {
            setAreaMenu(null)
            if (!await confirm({ title: '确定要删除所有没有媒体的空图集吗？' })) return
            try {
              const result = await albumsApi.cleanupEmpty()
              if (result.deleted_count === 0) {
                toast({ title: '没有空图集需要清理' })
              } else {
                toast({ title: `已清理 ${result.deleted_count} 个空图集` })
                fetchPersons()
              }
            } catch (err: any) {
              toast({ title: '清理失败', description: err.message, variant: 'destructive' })
            }
          }} />
        </ContextMenuPortal>
      )}

      <LightBox onShowInExplorer={handleShowInExplorer} onMoveToAlbum={handleMoveToAlbum} onAiAction={(cat, m) => setAiTarget({ category: cat, media: m })} />
      <ImportDialog
        open={importOpen}
        onOpenChange={(v) => { setImportOpen(v); if (!v) setImportPersonId(undefined) }}
        defaultPersonId={importPersonId}
        onComplete={() => { fetchPersons(); fetchUncategorized() }}
      />
      <MoveToAlbumDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        mediaIds={moveTarget}
        onComplete={() => { setMoveOpen(false); fetchUncategorized() }}
      />
      <WorkflowRunDialog
        open={!!aiTarget}
        onOpenChange={(v) => { if (!v) setAiTarget(null) }}
        category={aiTarget?.category || ''}
        sourceMedia={aiTarget?.media || null}
      />

      {/* Create person dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>新建人物</DialogTitle></DialogHeader>
          <Input
            placeholder="人物姓名..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button onClick={handleCreate} disabled={!newName.trim()}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create album dialog (from person card context menu) */}
      <Dialog open={createAlbumOpen} onOpenChange={setCreateAlbumOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>新建图集</DialogTitle></DialogHeader>
          <Input
            placeholder="图集名称..."
            value={newAlbumName}
            onChange={(e) => setNewAlbumName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newAlbumName.trim()) {
                createAlbum({ name: newAlbumName.trim(), person_id: createAlbumPersonId }).then(() => {
                  setCreateAlbumOpen(false)
                  toast({ title: '图集已创建' })
                  fetchPersons()
                }).catch((err: any) => toast({ title: '创建失败', description: err.message, variant: 'destructive' }))
              }
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateAlbumOpen(false)}>取消</Button>
            <Button disabled={!newAlbumName.trim()} onClick={() => {
              createAlbum({ name: newAlbumName.trim(), person_id: createAlbumPersonId }).then(() => {
                setCreateAlbumOpen(false)
                toast({ title: '图集已创建' })
                fetchPersons()
              }).catch((err: any) => toast({ title: '创建失败', description: err.message, variant: 'destructive' }))
            }}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cleanup low-rated dialog (from person card context menu) */}
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
            <Button variant="destructive" onClick={async () => {
              const allMedia = await mediaApi.explore({ person_id: cleanupPersonId })
              const lowScoreIds = allMedia.filter(m => m.rating !== null && m.rating <= cleanupThreshold).map(m => m.id)
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
                fetchPersons()
              } catch (err: any) {
                toast({ title: '批量删除失败', description: err.message, variant: 'destructive' })
              }
            }}>确认删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
