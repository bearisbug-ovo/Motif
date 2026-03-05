import { useEffect, useState, useMemo } from 'react'
import { Save, FolderOpen } from 'lucide-react'
import { useSystemStore } from '@/stores/system'
import { systemApi } from '@/api/system'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/hooks/use-toast'
import { getAllZoomDefaults, setZoomDefault, PAGE_LABELS, ZoomPageKey, ZoomPlatform } from '@/lib/zoomDefaults'
import { getAllFilterDefaults, setSortDefault, setFilterDefault, SORT_PAGE_LABELS, SORT_OPTIONS_BY_PAGE, SortPageKey } from '@/lib/filterDefaults'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export function Settings() {
  const { config, status, fetchConfig, fetchStatus, updateConfig } = useSystemStore()
  const [form, setForm] = useState({
    comfyui_url: '',
    thumbnail_size: 400,
    recycle_bin_days: 30,
    appdata_dir: '',
    task_timeout_minutes: 10,
  })
  const [saving, setSaving] = useState(false)
  const [zoomForm, setZoomForm] = useState<Record<string, number>>(() => getAllZoomDefaults())
  const [filterForm, setFilterForm] = useState(() => getAllFilterDefaults())

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
        task_timeout_minutes: config.task_timeout_minutes,
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
    <div data-testid="settings-page" className="flex flex-col h-full">
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

          {/* Zoom defaults */}
          <section>
            <h2 className="text-base font-semibold mb-4 pb-2 border-b border-border">网格缩放默认值</h2>
            <p className="text-xs text-muted-foreground mb-4">每次进入页面时的初始列数（图集行模式为行高 px）。桌面端和手机端分别设置。</p>
            <div className="space-y-3">
              {(Object.keys(PAGE_LABELS) as ZoomPageKey[]).map((pageKey) => (
                <div key={pageKey} className="flex items-center gap-3">
                  <span className="text-sm w-36 shrink-0">{PAGE_LABELS[pageKey]}</span>
                  {(['desktop', 'mobile'] as ZoomPlatform[]).map((platform) => {
                    const k = `${pageKey}-${platform}`
                    return (
                      <div key={platform} className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground w-8">{platform === 'desktop' ? 'PC' : '手机'}</span>
                        <Input
                          type="number"
                          min={1}
                          max={pageKey === 'album-row' ? 500 : 30}
                          value={zoomForm[k] ?? ''}
                          onChange={(e) => {
                            const v = parseInt(e.target.value)
                            if (!isNaN(v) && v > 0) {
                              setZoomForm(prev => ({ ...prev, [k]: v }))
                              setZoomDefault(pageKey, platform, v)
                            }
                          }}
                          className="w-16 h-8 text-sm"
                        />
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </section>

          {/* Filter defaults */}
          <section>
            <h2 className="text-base font-semibold mb-4 pb-2 border-b border-border">筛选默认值</h2>
            <p className="text-xs text-muted-foreground mb-4">每次进入页面时筛选条件重置为此处设定的默认值。</p>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-sm w-24 shrink-0">评分筛选</span>
                <Select value={filterForm.filterRating || 'all'} onValueChange={(v) => {
                  const val = v === 'all' ? '' : v
                  setFilterDefault('filterRating', val)
                  setFilterForm(prev => ({ ...prev, filterRating: val }))
                }}>
                  <SelectTrigger className="w-32 h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部</SelectItem>
                    <SelectItem value="gte:5">5星</SelectItem>
                    <SelectItem value="gte:4">4星+</SelectItem>
                    <SelectItem value="gte:3">3星+</SelectItem>
                    <SelectItem value="lte:2">2星以下</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm w-24 shrink-0">来源类型</span>
                <Select value={filterForm.sourceType || 'all'} onValueChange={(v) => {
                  const val = v === 'all' ? '' : v
                  setFilterDefault('sourceType', val)
                  setFilterForm(prev => ({ ...prev, sourceType: val }))
                }}>
                  <SelectTrigger className="w-32 h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部</SelectItem>
                    <SelectItem value="local">本地图</SelectItem>
                    <SelectItem value="generated">AI生成</SelectItem>
                    <SelectItem value="screenshot">截图</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="pt-2">
                <h3 className="text-sm font-medium mb-3">排序默认值</h3>
                <div className="space-y-3">
                  {(Object.keys(SORT_PAGE_LABELS) as SortPageKey[]).map((pageKey) => (
                    <div key={pageKey} className="flex items-center gap-3">
                      <span className="text-sm w-24 shrink-0">{SORT_PAGE_LABELS[pageKey]}</span>
                      <Select value={filterForm.sorts[pageKey]} onValueChange={(v) => {
                        setSortDefault(pageKey, v)
                        setFilterForm(prev => ({ ...prev, sorts: { ...prev.sorts, [pageKey]: v } }))
                      }}>
                        <SelectTrigger className="w-32 h-8 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SORT_OPTIONS_BY_PAGE[pageKey].map((o) => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* AI */}
          <section>
            <h2 className="text-base font-semibold mb-4 pb-2 border-b border-border">AI 配置</h2>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">任务超时 (分钟)</label>
                <Input
                  type="number"
                  min={1}
                  max={60}
                  value={form.task_timeout_minutes}
                  onChange={(e) => setForm((f) => ({ ...f, task_timeout_minutes: parseInt(e.target.value) || 10 }))}
                  className="w-32"
                />
                <p className="text-xs text-muted-foreground mt-1">单个任务的最大执行时间</p>
              </div>
            </div>
          </section>

          {/* Device Info */}
          <DeviceInfoSection />

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

function DeviceInfoSection() {
  const info = useMemo(() => {
    const w = window
    const s = w.screen
    const dpr = w.devicePixelRatio || 1
    const pointer = w.matchMedia('(pointer: coarse)').matches ? 'coarse (触屏)' : 'fine (鼠标)'
    const hover = w.matchMedia('(hover: hover)').matches ? '支持' : '不支持'
    const orientation = s.orientation?.type || 'unknown'
    const isMobileLayout = w.innerWidth < 768

    const breakpoints: Record<string, boolean> = {
      'sm (≥640px)': w.matchMedia('(min-width: 640px)').matches,
      'md (≥768px)': w.matchMedia('(min-width: 768px)').matches,
      'lg (≥1024px)': w.matchMedia('(min-width: 1024px)').matches,
      'xl (≥1280px)': w.matchMedia('(min-width: 1280px)').matches,
    }

    return {
      userAgent: navigator.userAgent,
      viewport: `${w.innerWidth} × ${w.innerHeight}`,
      screen: `${s.width} × ${s.height}`,
      physicalPx: `${Math.round(w.innerWidth * dpr)} × ${Math.round(w.innerHeight * dpr)}`,
      dpr: dpr.toFixed(2),
      pointer,
      hover,
      orientation,
      isMobileLayout: isMobileLayout ? '是 (BottomNav)' : '否 (Sidebar)',
      breakpoints,
    }
  }, [])

  const rows: [string, string][] = [
    ['User-Agent', info.userAgent],
    ['Viewport (CSS px)', info.viewport],
    ['屏幕分辨率', info.screen],
    ['物理像素', info.physicalPx],
    ['DPR (设备像素比)', info.dpr],
    ['Pointer 类型', info.pointer],
    ['Hover 支持', info.hover],
    ['屏幕方向', info.orientation],
    ['布局模式 (<768px)', info.isMobileLayout],
    ...Object.entries(info.breakpoints).map(([k, v]) => [`断点 ${k}`, v ? '✓ 命中' : '✗ 未命中'] as [string, string]),
  ]

  return (
    <section>
      <h2 className="text-base font-semibold mb-4 pb-2 border-b border-border">设备兼容性信息</h2>
      <div className="rounded-md bg-muted/30 p-4 space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-3 text-sm">
            <span className="text-muted-foreground shrink-0 w-40">{label}</span>
            <span className="break-all">{value}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
