import { useEffect, useState } from 'react'
import { Save, FolderOpen } from 'lucide-react'
import { useSystemStore } from '@/stores/system'
import { systemApi } from '@/api/system'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/hooks/use-toast'

export function Settings() {
  const { config, status, fetchConfig, fetchStatus, updateConfig } = useSystemStore()
  const [form, setForm] = useState({
    comfyui_url: '',
    thumbnail_size: 400,
    recycle_bin_days: 30,
    appdata_dir: '',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchConfig()
    fetchStatus()
  }, [fetchConfig, fetchStatus])

  useEffect(() => {
    if (config) {
      setForm({
        comfyui_url: config.comfyui_url,
        thumbnail_size: config.thumbnail_size,
        recycle_bin_days: config.recycle_bin_days,
        appdata_dir: config.appdata_dir,
      })
    }
  }, [config])

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateConfig(form)
      toast({ title: '设置已保存' })
    } catch (err: any) {
      toast({ title: '保存失败', description: err.message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const handlePickAppdata = async () => {
    try {
      const { path } = await systemApi.pickFolder()
      if (path) setForm((f) => ({ ...f, appdata_dir: path }))
    } catch {}
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 h-14 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">设置</h1>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          <Save className="w-4 h-4 mr-1.5" />
          保存
        </Button>
      </div>

      <div className="flex-1 overflow-auto px-6 py-6 max-w-2xl">
        <div className="space-y-8">
          {/* ComfyUI */}
          <section>
            <h2 className="text-base font-semibold mb-4 pb-2 border-b border-border">ComfyUI 连接</h2>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">ComfyUI 地址</label>
                <div className="flex items-center gap-2">
                  <Input
                    value={form.comfyui_url}
                    onChange={(e) => setForm((f) => ({ ...f, comfyui_url: e.target.value }))}
                    placeholder="http://127.0.0.1:8188"
                    className="flex-1"
                  />
                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${status?.comfyui.connected ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span className="text-sm text-muted-foreground">
                    {status?.comfyui.connected ? '已连接' : '未连接'}
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Display */}
          <section>
            <h2 className="text-base font-semibold mb-4 pb-2 border-b border-border">显示</h2>
            <div>
              <label className="text-sm font-medium mb-1.5 block">缩略图大小 (px)</label>
              <Input
                type="number"
                min={100}
                max={800}
                value={form.thumbnail_size}
                onChange={(e) => setForm((f) => ({ ...f, thumbnail_size: parseInt(e.target.value) || 400 }))}
                className="w-32"
              />
            </div>
          </section>

          {/* Storage */}
          <section>
            <h2 className="text-base font-semibold mb-4 pb-2 border-b border-border">存储</h2>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">AppData 目录</label>
                <div className="flex gap-2">
                  <Input
                    value={form.appdata_dir}
                    onChange={(e) => setForm((f) => ({ ...f, appdata_dir: e.target.value }))}
                    className="flex-1 text-sm"
                  />
                  <Button variant="outline" onClick={handlePickAppdata}>
                    <FolderOpen className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  存储数据库、缩略图和生成图的目录（修改后需要重启服务）
                </p>
              </div>

              {status?.disk && (
                <div className="rounded-md bg-muted/30 p-4">
                  <p className="text-sm font-medium mb-2">磁盘空间</p>
                  <div className="space-y-1 text-sm text-muted-foreground">
                    <p>总计：{status.disk.total_gb} GB</p>
                    <p>已用：{status.disk.used_gb} GB</p>
                    <p>可用：{status.disk.free_gb} GB</p>
                  </div>
                  <div className="mt-2 bg-muted rounded-full h-2">
                    <div
                      className="bg-primary rounded-full h-2"
                      style={{ width: `${(status.disk.used_gb / status.disk.total_gb) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="text-sm font-medium mb-1.5 block">回收站自动清除 (天)</label>
                <Input
                  type="number"
                  min={0}
                  max={365}
                  value={form.recycle_bin_days}
                  onChange={(e) => setForm((f) => ({ ...f, recycle_bin_days: parseInt(e.target.value) || 30 }))}
                  className="w-32"
                />
                <p className="text-xs text-muted-foreground mt-1">0 = 不自动清除</p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
