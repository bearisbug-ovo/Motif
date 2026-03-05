import { useEffect, useState } from 'react'
import { Plus, Download, Shuffle } from 'lucide-react'
import { usePersonStore } from '@/stores/person'
import { PersonCard } from '@/components/PersonCard'
import { FilterBar } from '@/components/FilterBar'
import { ImportDialog } from '@/components/ImportDialog'
import { ContextMenuPortal, MenuItem } from '@/components/ContextMenuPortal'
import { LightBox } from '@/components/LightBox'
import { useMediaStore } from '@/stores/media'
import { mediaApi } from '@/api/media'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'
import { useGridZoom, isMobile } from '@/hooks/useGridZoom'

const SORT_OPTIONS = [
  { value: 'created_at', label: '最新创建' },
  { value: 'avg_rating', label: '评分最高' },
  { value: 'name', label: '名称 A-Z' },
]

export function MediaLibrary() {
  const { persons, loading, sort, filterRating, fetchPersons, createPerson, setSort, setFilterRating, resetFilters } = usePersonStore()
  const { openLightbox } = useMediaStore()
  const [importOpen, setImportOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [areaMenu, setAreaMenu] = useState<{ x: number; y: number } | null>(null)
  const { value: cols, containerRef, gridStyle } = useGridZoom({ pageKey: 'media-library' })

  useEffect(() => { resetFilters(); fetchPersons() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const shuffleArray = <T,>(arr: T[]): T[] => {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }

  const handleExplore = async () => {
    try {
      const all = await mediaApi.explore({})
      if (all.length === 0) return
      const shuffled = shuffleArray(all)
      const onReshuffle = async () => {
        const items = await mediaApi.explore({})
        const re = shuffleArray(items)
        useMediaStore.setState({ lightboxItems: re, lightboxIndex: 0 })
      }
      openLightbox(shuffled, 0, { exploreMode: true, onReshuffle })
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
        />
      </div>

      {/* Grid */}
      <div ref={containerRef} className="flex-1 overflow-auto px-1 sm:px-6 py-2 sm:py-4 pb-28 md:pb-4" onContextMenu={(e) => {
        // Only fire on empty area (not on cards)
        if ((e.target as HTMLElement).closest('[data-card]')) return
        e.preventDefault()
        setAreaMenu({ x: e.clientX, y: e.clientY })
      }}>
        {loading ? (
          <div className="flex items-center justify-center h-64 text-muted-foreground">加载中...</div>
        ) : persons.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4 text-muted-foreground">
            <p>还没有任何人物</p>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4 mr-1.5" />
              创建第一个人物
            </Button>
          </div>
        ) : (
          <div data-testid="person-grid" style={gridStyle}>
            {persons.map((p) => (
              <PersonCard key={p.id} person={p} compact={cols >= (isMobile ? 4 : 10)} />
            ))}
          </div>
        )}
      </div>

      {/* Area context menu */}
      {areaMenu && (
        <ContextMenuPortal position={areaMenu} onClose={() => setAreaMenu(null)}>
          <MenuItem icon={<Plus className="w-3.5 h-3.5" />} label="新建人物" onClick={() => { setAreaMenu(null); setCreateOpen(true) }} />
          <MenuItem icon={<Download className="w-3.5 h-3.5" />} label="导入图片" onClick={() => { setAreaMenu(null); setImportOpen(true) }} />
        </ContextMenuPortal>
      )}

      <LightBox />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} onComplete={fetchPersons} />

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
    </div>
  )
}
