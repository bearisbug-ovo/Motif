import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Download, LayoutGrid, Rows3, Edit2, Trash2, FolderInput, FolderOpen, Shuffle, ZoomIn, Briefcase, Repeat, Paintbrush, ImageIcon, Star } from 'lucide-react'
import { useAlbumStore } from '@/stores/album'
import { usePersonStore } from '@/stores/person'
import { useMediaStore, setOnRatingChange } from '@/stores/media'
import { MediaCard } from '@/components/MediaCard'
import { FilterBar } from '@/components/FilterBar'
import { LightBox } from '@/components/LightBox'
import { ImportDialog } from '@/components/ImportDialog'
import { MoveToAlbumDialog } from '@/components/MoveToAlbumDialog'
import { SelectionToolbar } from '@/components/SelectionToolbar'
import { UpscaleDrawer } from '@/components/UpscaleDrawer'
import { FaceSwapDrawer } from '@/components/FaceSwapDrawer'
import { BatchFaceSwapDialog } from '@/components/BatchFaceSwapDialog'
import { MaskEditor } from '@/components/MaskEditor'
import { StarRating } from '@/components/StarRating'
import { ContextMenuPortal, MenuItem, MenuSeparator } from '@/components/ContextMenuPortal'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { mediaApi, MediaItem } from '@/api/media'
import { useWorkspaceStore } from '@/stores/workspace'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { useGridZoom } from '@/hooks/useGridZoom'

const SORT_OPTIONS = [
  { value: 'sort_order', label: '默认顺序' },
  { value: 'created_at', label: '最新添加' },
  { value: 'rating', label: '评分最高' },
]

type LayoutMode = 'grid' | 'row'

/** Row layout image — uses server dimensions for instant layout, falls back to onLoad */
function RowImage({ item, onClick, onContextMenu, rowHeight = 200 }: {
  item: MediaItem
  onClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
  rowHeight?: number
}) {
  // Use server-provided dimensions if available, otherwise detect from loaded image
  const serverAspect = (item.width && item.height) ? item.width / item.height : 0
  const [detectedAspect, setDetectedAspect] = useState(0)
  const aspect = serverAspect || detectedAspect || 1

  return (
    <div
      className="cursor-pointer rounded-none sm:rounded-md overflow-hidden bg-card border border-border relative group"
      style={{
        height: rowHeight,
        flexGrow: aspect,
        flexShrink: 0,
        flexBasis: `${rowHeight * aspect}px`,
        minWidth: 80,
      }}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <img
        src={mediaApi.itemThumbUrl(item, 400)}
        alt=""
        loading="lazy"
        className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
        onLoad={(e) => {
          if (!serverAspect) {
            const img = e.target as HTMLImageElement
            if (img.naturalWidth && img.naturalHeight) {
              setDetectedAspect(img.naturalWidth / img.naturalHeight)
            }
          }
        }}
        onError={(e) => { (e.target as HTMLImageElement).src = '/placeholder.svg' }}
      />
      {/* Rating badge */}
      {item.rating !== null && item.rating > 0 && (
        <div className="absolute top-1.5 left-1.5 bg-black/60 rounded px-1.5 py-0.5">
          <span className="text-xs text-white font-medium">★{item.rating}</span>
        </div>
      )}
      {/* Source badge */}
      {item.source_type !== 'local' && (
        <div className={cn(
          'absolute top-1.5 right-1.5 text-xs px-1.5 py-0.5 rounded',
          item.source_type === 'generated' ? 'bg-primary/80 text-white' : 'bg-blue-600/80 text-white'
        )}>
          {item.source_type === 'generated' ? 'AI' : '截图'}
        </div>
      )}
      {/* Video play icon */}
      {item.media_type === 'video' && (
        <div className="absolute bottom-1.5 right-1.5 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center">
          <svg className="w-3.5 h-3.5 text-white ml-0.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      )}
      {/* Hover overlay for consistency */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
    </div>
  )
}

export function AlbumDetail() {
  const { albumId } = useParams<{ albumId: string }>()
  const navigate = useNavigate()
  const { currentAlbum, fetchAlbum, updateAlbum, deleteAlbum } = useAlbumStore()
  const { items, loading, sort, filterRating, sourceType, fetchByAlbum, openLightbox, setSort, setFilterRating, setSourceType, resetFilters, multiSelectMode, setMultiSelectMode, selectedIds, toggleSelection } = useMediaStore()
  const [importOpen, setImportOpen] = useState(false)
  const [layout, setLayout] = useState<LayoutMode>('row')
  const [areaMenu, setAreaMenu] = useState<{ x: number; y: number } | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameName, setRenameName] = useState('')
  const [moveTarget, setMoveTarget] = useState<string[]>([])
  const [moveOpen, setMoveOpen] = useState(false)
  const [upscaleMedia, setUpscaleMedia] = useState<MediaItem | null>(null)
  const [faceSwapMedia, setFaceSwapMedia] = useState<MediaItem | null>(null)
  const [batchFaceSwapOpen, setBatchFaceSwapOpen] = useState(false)
  const [inpaintMedia, setInpaintMedia] = useState<MediaItem | null>(null)
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; item: MediaItem } | null>(null)

  // Detect mobile for force-grid
  const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches
  const effectiveLayout = isMobile ? 'grid' : layout

  // Grid zoom for grid mode
  const gridZoom = useGridZoom({ pageKey: 'album-grid' })
  const compact = gridZoom.value >= (isMobile ? 4 : 10)
  // Row zoom for row mode (controls row height in px)
  const rowZoom = useGridZoom({ pageKey: 'album-row', min: 50, max: 500 })

  const handleShowInExplorer = useCallback((item: MediaItem) => {
    mediaApi.showInExplorer(item.id).catch(() => toast({ title: '无法打开', variant: 'destructive' }))
  }, [])

  const handleMoveToAlbum = useCallback((item: MediaItem) => {
    setMoveTarget([item.id])
    setMoveOpen(true)
  }, [])

  const handleRefresh = useCallback(() => {
    if (!albumId) return
    fetchAlbum(albumId)
    fetchByAlbum(albumId)
  }, [albumId, fetchAlbum, fetchByAlbum])

  // Fisher-Yates shuffle
  const shuffleArray = <T,>(arr: T[]): T[] => {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }

  const handleExplore = useCallback(() => {
    if (items.length === 0) return
    const shuffled = shuffleArray(items)
    const onReshuffle = () => {
      const re = shuffleArray(items)
      useMediaStore.setState({ lightboxItems: re, lightboxIndex: 0 })
    }
    openLightbox(shuffled, 0, {
      albumId,
      personId: currentAlbum?.person_id || undefined,
      onCoverSet: handleRefresh,
      exploreMode: true,
      onReshuffle,
    })
  }, [items, albumId, currentAlbum, openLightbox, handleRefresh])

  useEffect(() => {
    if (!albumId) return
    resetFilters('album-detail')
    fetchAlbum(albumId)
    fetchByAlbum(albumId)
  }, [albumId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setOnRatingChange(handleRefresh)
    return () => setOnRatingChange(null)
  }, [handleRefresh])

  const openLB = (m: MediaItem) => {
    const idx = items.findIndex((x) => x.id === m.id)
    if (idx < 0) return
    openLightbox(items, idx, {
      albumId,
      personId: currentAlbum?.person_id || undefined,
      onCoverSet: handleRefresh,
    })
  }

  return (
    <div data-testid="album-detail-page" className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-1.5 sm:gap-4 px-3 sm:px-6 h-12 sm:h-14 border-b border-border shrink-0">
        <Button variant="ghost" size="sm" className="h-7 sm:h-8 px-1.5 sm:px-3" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-4 h-4 sm:mr-1" />
          <span className="hidden sm:inline">返回</span>
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm sm:text-base font-semibold truncate">{currentAlbum?.name || '...'}</h1>
          {currentAlbum && (
            <p className="text-[10px] sm:text-xs text-muted-foreground">{currentAlbum.media_count} 张</p>
          )}
        </div>
        {currentAlbum?.avg_rating !== null && currentAlbum?.avg_rating !== undefined && (
          <StarRating value={Math.round(currentAlbum.avg_rating)} readonly />
        )}
        {!isMobile && (
          <div className="flex items-center border border-border rounded-md overflow-hidden">
            <button
              className={cn('p-1.5 transition-colors', layout === 'row' ? 'bg-accent' : 'hover:bg-accent/50')}
              onClick={() => setLayout('row')}
              title="等高行布局"
            >
              <Rows3 className="w-4 h-4" />
            </button>
            <button
              className={cn('p-1.5 transition-colors', layout === 'grid' ? 'bg-accent' : 'hover:bg-accent/50')}
              onClick={() => setLayout('grid')}
              title="方块网格"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>
        )}
        <Button variant="outline" size="sm" className="h-7 sm:h-8 w-7 sm:w-auto p-0 sm:px-3" onClick={handleExplore} disabled={items.length === 0}>
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
      </div>

      {/* Filter bar */}
      <div className="px-3 sm:px-6 py-2 sm:py-3 border-b border-border shrink-0">
        <FilterBar
          sortField={sort}
          sortOptions={SORT_OPTIONS}
          onSortChange={(v) => { setSort(v as any); if (albumId) fetchByAlbum(albumId) }}
          ratingFilter={filterRating}
          onRatingFilterChange={(v) => { setFilterRating(v || undefined); if (albumId) fetchByAlbum(albumId) }}
          sourceType={sourceType}
          onSourceTypeChange={(v) => { setSourceType(v || undefined); if (albumId) fetchByAlbum(albumId) }}
        />
      </div>

      {/* Content */}
      <div
        ref={effectiveLayout === 'grid' ? gridZoom.containerRef : rowZoom.containerRef}
        className="flex-1 overflow-auto px-1 sm:px-6 py-2 sm:py-4 pb-28 md:pb-4"
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest('[data-card],.group')) return
          e.preventDefault()
          setAreaMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        {loading ? (
          <div className="flex items-center justify-center h-64 text-muted-foreground">加载中...</div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4 text-muted-foreground">
            <p>图集中还没有图片</p>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Download className="w-4 h-4 mr-1.5" />
              导入图片
            </Button>
          </div>
        ) : effectiveLayout === 'grid' ? (
          /* Square grid mode */
          <div style={gridZoom.gridStyle}>
            {items.map((m) => (
              <MediaCard
                key={m.id}
                item={m}
                showRating={false}
                compact={compact}
                albumId={albumId}
                personId={currentAlbum?.person_id || undefined}
                onCoverSet={handleRefresh}
                onClick={() => openLB(m)}
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
        ) : (
          /* Equal-height row mode — images fill rows with varying widths based on aspect ratio */
          <div className="flex flex-wrap gap-1.5" style={{ alignContent: 'flex-start' }}>
            {items.map((m) => (
              <RowImage key={m.id} item={m} rowHeight={rowZoom.value} onClick={() => openLB(m)} onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setRowMenu({ x: e.clientX, y: e.clientY, item: m })
              }} />
            ))}
            {/* Invisible spacers to prevent last row from over-stretching */}
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={`spacer-${i}`} style={{ flexGrow: 1, height: 0, flexBasis: `${rowZoom.value}px` }} />
            ))}
          </div>
        )}
      </div>

      {/* Area context menu */}
      {areaMenu && (
        <ContextMenuPortal position={areaMenu} onClose={() => setAreaMenu(null)}>
          <MenuItem icon={<Edit2 className="w-3.5 h-3.5" />} label="重命名图集" onClick={() => {
            setAreaMenu(null)
            setRenameName(currentAlbum?.name || '')
            setRenameOpen(true)
          }} />
          <MenuItem icon={<Download className="w-3.5 h-3.5" />} label="导入" onClick={() => { setAreaMenu(null); setImportOpen(true) }} />
          <MenuItem icon={<Repeat className="w-3.5 h-3.5" />} label="批量换脸" onClick={() => { setAreaMenu(null); setBatchFaceSwapOpen(true) }} />
          <MenuSeparator />
          <MenuItem icon={<Trash2 className="w-3.5 h-3.5" />} label="删除图集" onClick={async () => {
            setAreaMenu(null)
            if (albumId && confirm('确定要删除此图集吗？')) {
              await deleteAlbum(albumId)
              navigate(-1)
            }
          }} destructive />
        </ContextMenuPortal>
      )}

      {/* Row-mode image context menu */}
      {rowMenu && (
        <ContextMenuPortal position={rowMenu} onClose={() => setRowMenu(null)}>
          {albumId && (
            <MenuItem icon={<ImageIcon className="w-3.5 h-3.5" />} label="设为图集封面" onClick={async () => {
              setRowMenu(null)
              try {
                await useAlbumStore.getState().updateAlbum(albumId, { cover_media_id: rowMenu.item.id })
                toast({ title: '已设为图集封面' })
                handleRefresh()
              } catch { toast({ title: '设置封面失败', variant: 'destructive' }) }
            }} />
          )}
          {currentAlbum?.person_id && (
            <MenuItem icon={<ImageIcon className="w-3.5 h-3.5" />} label="设为人物封面" onClick={async () => {
              setRowMenu(null)
              try {
                await usePersonStore.getState().updatePerson(currentAlbum.person_id!, { cover_media_id: rowMenu.item.id })
                toast({ title: '已设为人物封面' })
                handleRefresh()
              } catch { toast({ title: '设置封面失败', variant: 'destructive' }) }
            }} />
          )}
          {rowMenu.item.media_type === 'image' && (
            <MenuItem icon={<ZoomIn className="w-3.5 h-3.5" />} label="高清放大" onClick={() => { setUpscaleMedia(rowMenu.item); setRowMenu(null) }} />
          )}
          {rowMenu.item.media_type === 'image' && (
            <MenuItem icon={<Repeat className="w-3.5 h-3.5" />} label="换脸" onClick={() => { setFaceSwapMedia(rowMenu.item); setRowMenu(null) }} />
          )}
          {rowMenu.item.media_type === 'image' && (
            <MenuItem icon={<Paintbrush className="w-3.5 h-3.5" />} label="局部修复" onClick={() => { setInpaintMedia(rowMenu.item); setRowMenu(null) }} />
          )}
          <MenuItem icon={<Briefcase className="w-3.5 h-3.5" />} label="加入工作区" onClick={async () => {
            setRowMenu(null)
            try { await useWorkspaceStore.getState().addItem(rowMenu.item.id); toast({ title: '已加入工作区' }) }
            catch (err: any) { toast({ title: err.message || '添加失败', variant: 'destructive' }) }
          }} />
          <MenuItem icon={<FolderInput className="w-3.5 h-3.5" />} label="移动到图集" onClick={() => { handleMoveToAlbum(rowMenu.item); setRowMenu(null) }} />
          <MenuItem icon={<FolderOpen className="w-3.5 h-3.5" />} label="在资源管理器中显示" onClick={() => { handleShowInExplorer(rowMenu.item); setRowMenu(null) }} />
          {/* Quick rating */}
          <div className="px-3 py-1.5 flex items-center gap-1">
            <Star className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-muted-foreground text-xs mr-1">评分</span>
            {[1, 2, 3, 4, 5].map((r) => (
              <button
                key={r}
                className={cn(
                  'w-5 h-5 rounded text-xs font-medium transition-colors',
                  rowMenu.item.rating === r ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                )}
                onClick={async () => {
                  setRowMenu(null)
                  await useMediaStore.getState().updateMedia(rowMenu.item.id, { rating: r })
                }}
              >
                {r}
              </button>
            ))}
          </div>
          <MenuSeparator />
          <MenuItem icon={<Trash2 className="w-3.5 h-3.5" />} label="删除" onClick={async () => {
            setRowMenu(null)
            if (confirm('确定要删除这张图片吗？')) {
              await useMediaStore.getState().softDelete(rowMenu.item.id)
            }
          }} destructive />
        </ContextMenuPortal>
      )}

      {/* Rename album dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>重命名图集</DialogTitle></DialogHeader>
          <Input
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && renameName.trim() && albumId) {
                updateAlbum(albumId, { name: renameName.trim() }).then(() => {
                  setRenameOpen(false)
                  handleRefresh()
                })
              }
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>取消</Button>
            <Button onClick={() => {
              if (renameName.trim() && albumId) {
                updateAlbum(albumId, { name: renameName.trim() }).then(() => {
                  setRenameOpen(false)
                  handleRefresh()
                })
              }
            }}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LightBox onShowInExplorer={handleShowInExplorer} onMoveToAlbum={handleMoveToAlbum} onUpscale={(m) => setUpscaleMedia(m)} onFaceSwap={(m) => setFaceSwapMedia(m)} onInpaint={(m) => setInpaintMedia(m)} onScreenshotUpscale={(m) => setUpscaleMedia(m)} />
      <MoveToAlbumDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        mediaIds={moveTarget}
        personId={currentAlbum?.person_id || undefined}
        onComplete={handleRefresh}
      />
      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        defaultAlbumId={albumId}
        defaultPersonId={currentAlbum?.person_id || undefined}
        onComplete={handleRefresh}
      />
      <SelectionToolbar
        personId={currentAlbum?.person_id || undefined}
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
      <BatchFaceSwapDialog
        open={batchFaceSwapOpen}
        onOpenChange={setBatchFaceSwapOpen}
        albumId={albumId || ''}
        albumName={currentAlbum?.name || ''}
        personId={currentAlbum?.person_id || undefined}
        imageCount={items.filter(m => m.media_type === 'image').length}
        onComplete={handleRefresh}
      />
      <MaskEditor
        open={!!inpaintMedia}
        onClose={() => setInpaintMedia(null)}
        media={inpaintMedia}
      />
    </div>
  )
}
