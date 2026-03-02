import { useEffect, useState } from 'react'
import { RotateCcw, Trash2, Trash } from 'lucide-react'
import { recycleBinApi, RecycleBinResponse } from '@/api/recycleBin'
import { mediaApi } from '@/api/media'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'

export function RecycleBin() {
  const [data, setData] = useState<RecycleBinResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)

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
    if (!confirm('永久删除此文件？此操作不可撤销。')) return
    try {
      await recycleBinApi.permanentDelete(id)
      toast({ title: '已永久删除' })
      fetchData()
    } catch (err: any) {
      toast({ title: '删除失败', description: err.message, variant: 'destructive' })
    }
  }

  const handleEmpty = async () => {
    if (!confirm(`确定清空回收站（共 ${data?.total} 项）？此操作不可撤销。`)) return
    try {
      await recycleBinApi.empty()
      toast({ title: '回收站已清空' })
      fetchData()
    } catch (err: any) {
      toast({ title: '清空失败', description: err.message, variant: 'destructive' })
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 h-14 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">回收站</h1>
        <div className="flex items-center gap-2">
          {data && data.total > 0 && (
            <Button variant="destructive" size="sm" onClick={handleEmpty}>
              <Trash className="w-4 h-4 mr-1.5" />
              清空回收站 ({data.total})
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-64 text-muted-foreground">加载中...</div>
        ) : !data || data.items.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            回收站为空
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-3">
            {data.items.map((item) => (
              <div key={item.id} className="group relative rounded-md overflow-hidden bg-card border border-border">
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
                <div className="p-1.5">
                  <p className="text-xs text-muted-foreground truncate">{item.file_path.split(/[\\/]/).pop()}</p>
                  {item.deleted_at && (
                    <p className="text-xs text-muted-foreground/60">
                      {new Date(item.deleted_at).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
