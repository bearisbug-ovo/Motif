import { useEffect, useState } from 'react'
import { Plus, Download } from 'lucide-react'
import { usePersonStore } from '@/stores/person'
import { PersonCard } from '@/components/PersonCard'
import { FilterBar } from '@/components/FilterBar'
import { ImportDialog } from '@/components/ImportDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'

const SORT_OPTIONS = [
  { value: 'created_at', label: '最新创建' },
  { value: 'avg_rating', label: '评分最高' },
  { value: 'name', label: '名称 A-Z' },
]

export function MediaLibrary() {
  const { persons, loading, sort, filterRating, fetchPersons, createPerson, setSort, setFilterRating } = usePersonStore()
  const [importOpen, setImportOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')

  useEffect(() => { fetchPersons() }, [fetchPersons])

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
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 h-14 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">人物库</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <Download className="w-4 h-4 mr-1.5" />
            导入图片
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-1.5" />
            新建人物
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="px-6 py-3 border-b border-border shrink-0">
        <FilterBar
          sortField={sort}
          sortOptions={SORT_OPTIONS}
          onSortChange={(v) => setSort(v as any)}
          ratingFilter={filterRating}
          onRatingFilterChange={(v) => setFilterRating(v || undefined)}
        />
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto px-6 py-4">
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
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-4">
            {persons.map((p) => (
              <PersonCard key={p.id} person={p} />
            ))}
          </div>
        )}
      </div>

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
