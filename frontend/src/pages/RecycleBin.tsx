import { useEffect, useState } from 'react'
import { RotateCcw, Trash2, Trash, ChevronLeft, ChevronRight } from 'lucide-react'
import { recycleBinApi, RecycleBinItem } from '@/api/recycleBin'
import { mediaApi } from '@/api/media'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { confirm } from '@/components/ConfirmDialog'
import { useGridZoom } from '@/hooks/useGridZoom'
import { EmptyState } from '@/components/Skeleton'

interface RecycleBinData {
  total: number
  page: number
  page_size: number
  items: RecycleBinItem[]
}

export function RecycleBinContent() {
  const [data, setData] = useState<RecycleBinData | null>(null)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const { containerRef, gridStyle } = useGridZoom({ pageKey: 'recycle-bin' })

  const fetchData = async (p = page) => {
    setLoading(true)
    try {
      const d = await recycleBinApi.list(p, 50)
      setData(d)
    } catch (err: any) {
      toast({ title: '加载失败', description: err.message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [page])

  const handleRestore = async (id: string) => {
    try {
      await recycleBinApi.restore(id)
      toast({ title: '已恢复' })
      fetchData()
    } catch (err: any) {
      toast({ title: '恢复失败', description: err.message, variant: 'destructive' })
    }
  }

  const handleDelete = async (id: string) => {
    if (!await confirm({ title: '永久删除此文件？', description: '此操作不可撤销。' })) return
    try {
      await recycleBinApi.permanentDelete(id)
      toast({ title: '已永久删除' })
      fetchData()
    } catch (err: any) {
      toast({ title: '删除失败', description: err.message, variant: 'destructive' })
    }
  }

  const handleEmpty = async () => {
    if (!await confirm({ title: `确定清空回收站（共 ${data?.total} 项）？`, description: '此操作不可撤销。' })) return
    try {
      await recycleBinApi.empty()
      toast({ title: '回收站已清空' })
      fetchData()
    } catch (err: any) {
      toast({ title: '清空失败', description: err.message, variant: 'destructive' })
    }
  }

  const totalPages = data ? Math.ceil(data.total / data.page_size) : 0

  return (
    <div data-testid="recycle-bin-page" className="flex flex-col h-full">
      {/* Toolbar */}
      {data && data.total > 0 && (
        <div className="flex items-center justify-between px-1 sm:px-6 py-2 shrink-0">
          <span className="text-sm text-muted-foreground">共 {data.total} 项</span>
          <Button variant="destructive" size="sm" onClick={handleEmpty}>
            <Trash className="w-4 h-4 mr-1.5" />
            清空回收站
          </Button>
        </div>
      )}

      <div ref={containerRef} className="flex-1 overflow-auto px-1 sm:px-6 py-2 sm:py-4 pb-28 md:pb-4">
        {!data || data.items.length === 0 ? (
          <EmptyState icon={Trash} title="回收站为空" description="删除的图片会出现在这里" />
        ) : (
          <div style={gridStyle}>
            {data.items.map((item) => (
              <div key={item.id} data-testid="recycle-item" className="group relative rounded-none sm:rounded-md overflow-hidden bg-card border border-border">
                <div className="aspect-square overflow-hidden">
                  <img
                    src={mediaApi.thumbUrl(item.file_path, 200)}
                    alt=""
                    loading="lazy"
                    className="w-full h-full object-cover opacity-60"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                </div>
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <button
                    onClick={() => handleRestore(item.id)}
                    className="p-1.5 rounded-md bg-primary/80 hover:bg-primary text-white transition-colors"
                    title="恢复"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="p-1.5 rounded-md bg-destructive/80 hover:bg-destructive text-white transition-colors"
                    title="永久删除"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="p-1.5 space-y-0.5">
                  <p className="text-xs text-muted-foreground truncate">{item.file_path.split(/[\\/]/).pop()}</p>
                  {(item.person_name || item.album_name) && (
                    <p className="text-xs text-muted-foreground/80 truncate">
                      {[item.person_name, item.album_name].filter(Boolean).join(' / ')}
                    </p>
                  )}
                  <div className="flex items-center justify-between">
                    {item.deleted_at && (
                      <span className="text-xs text-muted-foreground/60">
                        {new Date(item.deleted_at).toLocaleDateString()}
                      </span>
                    )}
                    {item.days_until_auto_delete != null && (
                      <span className={`text-xs ${item.days_until_auto_delete <= 3 ? 'text-red-400' : 'text-muted-foreground/60'}`}>
                        {item.days_until_auto_delete}天后删除
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 px-6 py-3 border-t border-border shrink-0">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            <ChevronLeft className="w-4 h-4" />
            上一页
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            下一页
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  )
}
