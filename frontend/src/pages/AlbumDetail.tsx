import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Download, LayoutGrid, Rows3 } from 'lucide-react'
import { useAlbumStore } from '@/stores/album'
import { useMediaStore, setOnRatingChange } from '@/stores/media'
import { MediaCard } from '@/components/MediaCard'
import { FilterBar } from '@/components/FilterBar'
import { LightBox } from '@/components/LightBox'
import { ImportDialog } from '@/components/ImportDialog'
import { StarRating } from '@/components/StarRating'
import { Button } from '@/components/ui/button'
import { mediaApi, MediaItem } from '@/api/media'
import { cn } from '@/lib/utils'

const SORT_OPTIONS = [
  { value: 'sort_order', label: '默认顺序' },
  { value: 'created_at', label: '最新添加' },
  { value: 'rating', label: '评分最高' },
]

type LayoutMode = 'grid' | 'row'

const ROW_HEIGHT = 200 // px base height for row layout

/** Row layout image — uses server dimensions for instant layout, falls back to onLoad */
function RowImage({ item, onClick }: {
  item: MediaItem
  onClick: () => void
}) {
  // Use server-provided dimensions if available, otherwise detect from loaded image
  const serverAspect = (item.width && item.height) ? item.width / item.height : 0
  const [detectedAspect, setDetectedAspect] = useState(0)
  const aspect = serverAspect || detectedAspect || 1

  return (
    <div
      className="cursor-pointer rounded-md overflow-hidden bg-card border border-border relative group"
      style={{
        height: ROW_HEIGHT,
        flexGrow: aspect,
        flexShrink: 0,
        flexBasis: `${ROW_HEIGHT * aspect}px`,
        minWidth: 80,
      }}
      onClick={onClick}
    >
      <img
        src={mediaApi.thumbUrl(item.file_path, 400)}
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
      {/* Hover overlay for consistency */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
    </div>
  )
}

export function AlbumDetail() {
  const { albumId } = useParams<{ albumId: string }>()
  const navigate = useNavigate()
  const { currentAlbum, fetchAlbum } = useAlbumStore()
  const { items, loading, sort, filterRating, sourceType, fetchByAlbum, openLightbox, setSort, setFilterRating, setSourceType } = useMediaStore()
  const [importOpen, setImportOpen] = useState(false)
  const [layout, setLayout] = useState<LayoutMode>('row')

  useEffect(() => {
    if (!albumId) return
    fetchAlbum(albumId)
    fetchByAlbum(albumId)
  }, [albumId, fetchAlbum, fetchByAlbum])

  const handleRefresh = useCallback(() => {
    if (!albumId) return
    fetchAlbum(albumId)
    fetchByAlbum(albumId)
  }, [albumId, fetchAlbum, fetchByAlbum])

  useEffect(() => {
    setOnRatingChange(handleRefresh)
    return () => setOnRatingChange(null)
  }, [handleRefresh])

  const images = items.filter((m) => m.media_type === 'image')

  const openLB = (m: MediaItem) => {
    if (m.media_type !== 'image') return // Skip video items for now
    const idx = images.findIndex((x) => x.id === m.id)
    if (idx < 0) return
    openLightbox(images, idx, {
      albumId,
      personId: currentAlbum?.person_id || undefined,
      onCoverSet: handleRefresh,
    })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 h-14 border-b border-border shrink-0">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-4 h-4 mr-1" />
          返回
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold truncate">{currentAlbum?.name || '...'}</h1>
          {currentAlbum && (
            <p className="text-xs text-muted-foreground">{currentAlbum.media_count} 张</p>
          )}
        </div>
        {currentAlbum?.avg_rating !== null && currentAlbum?.avg_rating !== undefined && (
          <StarRating value={Math.round(currentAlbum.avg_rating)} readonly />
        )}
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
        <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
          <Download className="w-4 h-4 mr-1.5" />
          导入
        </Button>
      </div>

      {/* Filter bar */}
      <div className="px-6 py-3 border-b border-border shrink-0">
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
      <div className="flex-1 overflow-auto px-6 py-4">
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
        ) : layout === 'grid' ? (
          /* Square grid mode */
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2">
            {items.map((m) => (
              <MediaCard
                key={m.id}
                item={m}
                showRating={false}
                albumId={albumId}
                personId={currentAlbum?.person_id || undefined}
                onCoverSet={handleRefresh}
                onClick={() => openLB(m)}
              />
            ))}
          </div>
        ) : (
          /* Equal-height row mode — images fill rows with varying widths based on aspect ratio */
          <div className="flex flex-wrap gap-1.5" style={{ alignContent: 'flex-start' }}>
            {items.map((m) => (
              <RowImage key={m.id} item={m} onClick={() => openLB(m)} />
            ))}
            {/* Invisible spacers to prevent last row from over-stretching */}
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={`spacer-${i}`} style={{ flexGrow: 1, height: 0, flexBasis: `${ROW_HEIGHT}px` }} />
            ))}
          </div>
        )}
      </div>

      <LightBox />
      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        defaultAlbumId={albumId}
        defaultPersonId={currentAlbum?.person_id || undefined}
        onComplete={handleRefresh}
      />
    </div>
  )
}
