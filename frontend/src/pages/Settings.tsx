import { useEffect, useState } from 'react'
import { Save, FolderOpen, Sun, Moon, Monitor, Trash2, Edit2, Merge } from 'lucide-react'
import { useSystemStore } from '@/stores/system'
import { useTagStore } from '@/stores/tag'
import { systemApi } from '@/api/system'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/hooks/use-toast'
import { confirm } from '@/components/ConfirmDialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { getAllZoomDefaults, setZoomDefault, PAGE_LABELS, ZoomPageKey, ZoomPlatform } from '@/lib/zoomDefaults'
import { getAllFilterDefaults, setSortDefault, setFilterDefault, SORT_PAGE_LABELS, SORT_OPTIONS_BY_PAGE, SortPageKey } from '@/lib/filterDefaults'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RecycleBinContent } from '@/pages/RecycleBin'
import { WorkspaceContent } from '@/pages/Workspace'
import { DashboardContent } from '@/pages/Dashboard'
import { cn } from '@/lib/utils'
import { getTheme, setTheme, type Theme } from '@/lib/theme'

declare const __BUILD_TIME__: string

type SettingsTab = 'appearance' | 'services' | 'tags' | 'workspace' | 'recycle-bin' | 'dashboard'

const TABS: { key: SettingsTab; label: string }[] = [
  { key: 'appearance', label: '外观' },
  { key: 'services', label: '服务' },
  { key: 'tags', label: '标签' },
  { key: 'workspace', label: '工作区' },
  { key: 'recycle-bin', label: '回收站' },
  { key: 'dashboard', label: '控制台' },
]

export function Settings() {
  const { config, status, fetchConfig, fetchStatus, updateConfig } = useSystemStore()
  const [form, setForm] = useState({
    comfyui_url: '',
    comfyui_launch_cmd: '',
    thumbnail_size: 400,
    recycle_bin_days: 30,
    appdata_dir: '',
    task_timeout_minutes: 10,
    fastapi_port: 8000,
    platform_cookies: {} as Record<string, string>,
  })
  const [saving, setSaving] = useState(false)
  const [zoomForm, setZoomForm] = useState<Record<string, number>>(() => getAllZoomDefaults())
  const [filterForm, setFilterForm] = useState(() => getAllFilterDefaults())
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance')
  const [currentTheme, setCurrentTheme] = useState<Theme>(getTheme)

  useEffect(() => {
    fetchConfig()
    fetchStatus()
  }, [fetchConfig, fetchStatus])

  useEffect(() => {
    if (config) {
      setForm({
        comfyui_url: config.comfyui_url,
        comfyui_launch_cmd: config.comfyui_launch_cmd || '',
        thumbnail_size: config.thumbnail_size,
        recycle_bin_days: config.recycle_bin_days,
        appdata_dir: config.appdata_dir,
        task_timeout_minutes: config.task_timeout_minutes,
        fastapi_port: config.fastapi_port || 8000,
        platform_cookies: config.platform_cookies || {},
      })
    }
  }, [config])

  const handleSave = async () => {
    if (config && form.appdata_dir !== config.appdata_dir) {
      if (!await confirm({ title: '确定要更改 AppData 目录吗？', description: '将会复制所有文件到新位置并更新数据库路径。此操作可能需要一些时间，完成后需重启后端。' })) {
        return
      }
    }
    setSaving(true)
    try {
      const result = await updateConfig(form)
      toast({ title: result?.restart_required ? '设置已保存，请重启后端服务' : '设置已保存' })
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

  const handleThemeChange = (theme: Theme) => {
    setTheme(theme)
    setCurrentTheme(theme)
  }

  const showSave = activeTab === 'services'

  return (
    <div data-testid="settings-page" className="flex flex-col h-full">
      {/* Header with tabs */}
      <div className="border-b border-border shrink-0">
        <div className="flex items-center gap-4 px-6 h-14 max-w-2xl mx-auto">
          <h1 className="text-lg font-semibold shrink-0">设置</h1>
          <div className="flex gap-1 bg-muted rounded-md p-0.5 overflow-x-auto">
            {TABS.map(({ key, label }) => (
              <button
                key={key}
                className={cn(
                  'px-3 py-1 text-sm rounded transition-colors whitespace-nowrap',
                  activeTab === key ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'
                )}
                onClick={() => setActiveTab(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          {showSave && (
            <Button size="sm" onClick={handleSave} disabled={saving}>
              <Save className="w-4 h-4 mr-1.5" />
              保存
            </Button>
          )}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 'tags' ? (
        <div className="flex-1 overflow-auto px-6 py-6 pb-28 md:pb-4">
          <div className="max-w-2xl mx-auto">
            <TagManagement />
          </div>
        </div>
      ) : activeTab === 'workspace' ? (
        <div className="flex-1 overflow-hidden">
          <WorkspaceContent />
        </div>
      ) : activeTab === 'recycle-bin' ? (
        <div className="flex-1 overflow-hidden">
          <RecycleBinContent />
        </div>
      ) : activeTab === 'dashboard' ? (
        <div className="flex-1 overflow-hidden">
          <DashboardContent />
        </div>
      ) : activeTab === 'appearance' ? (
        <div className="flex-1 overflow-auto px-6 py-6 pb-28 md:pb-4">
          <div className="max-w-2xl mx-auto space-y-8">
            {/* Theme */}
            <section>
              <h2 className="text-base font-semibold mb-4 pb-2 border-b border-border">主题</h2>
              <div className="flex gap-3">
                {([
                  { value: 'light' as Theme, icon: Sun, label: '浅色' },
                  { value: 'dark' as Theme, icon: Moon, label: '深色' },
                  { value: 'system' as Theme, icon: Monitor, label: '跟随系统' },
                ]).map(({ value, icon: Icon, label }) => (
                  <button
                    key={value}
                    onClick={() => handleThemeChange(value)}
                    className={cn(
                      'flex flex-col items-center gap-2 px-6 py-4 rounded-lg border transition-colors',
                      currentTheme === value
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
                    )}
                  >
                    <Icon className="w-6 h-6" />
                    <span className="text-sm font-medium">{label}</span>
                  </button>
                ))}
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
                <div className="flex items-center gap-3">
                  <span className="text-sm w-24 shrink-0">媒体类型</span>
                  <Select value={filterForm.mediaType || 'all'} onValueChange={(v) => {
                    const val = v === 'all' ? '' : v
                    setFilterDefault('mediaType', val)
                    setFilterForm(prev => ({ ...prev, mediaType: val }))
                  }}>
                    <SelectTrigger className="w-32 h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部</SelectItem>
                      <SelectItem value="image">图片</SelectItem>
                      <SelectItem value="video">视频</SelectItem>
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
          </div>
        </div>
      ) : (
        /* Services tab */
        <div className="flex-1 overflow-auto px-6 py-6 pb-28 md:pb-4">
          <div className="max-w-2xl mx-auto space-y-8">
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
                <div>
                  <label className="text-sm font-medium mb-1.5 block">ComfyUI 启动命令</label>
                  <Input
                    value={form.comfyui_launch_cmd}
                    onChange={(e) => setForm((f) => ({ ...f, comfyui_launch_cmd: e.target.value }))}
                    placeholder='例如: "D:/ai/ComfyUI/python/python.exe" "D:/ai/ComfyUI/main.py" --port 8188'
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-1">用于从 Motif 内启动 ComfyUI 的完整命令行</p>
                </div>
              </div>
            </section>

            {/* Platform Cookies */}
            <section>
              <h2 className="text-base font-semibold mb-4 pb-2 border-b border-border">平台 Cookie</h2>
              <p className="text-xs text-muted-foreground mb-4">
                部分平台的网页抓取需要登录 Cookie。请在浏览器中登录后，打开开发者工具 (F12) → Network → 复制请求头中的 Cookie 值粘贴到此处。
              </p>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">抖音 Cookie</label>
                  <textarea
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                    rows={3}
                    placeholder="从浏览器复制抖音登录后的 Cookie..."
                    value={form.platform_cookies.douyin || ''}
                    onChange={(e) => setForm((f) => ({
                      ...f,
                      platform_cookies: { ...f.platform_cookies, douyin: e.target.value },
                    }))}
                  />
                  {form.platform_cookies.douyin ? (
                    <p className="text-xs text-green-600 dark:text-green-400 mt-1">已配置</p>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">未配置，抖音抓取功能将不可用</p>
                  )}
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">小红书 Cookie</label>
                  <textarea
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                    rows={3}
                    placeholder="从浏览器复制小红书登录后的 Cookie..."
                    value={form.platform_cookies.xiaohongshu || ''}
                    onChange={(e) => setForm((f) => ({
                      ...f,
                      platform_cookies: { ...f.platform_cookies, xiaohongshu: e.target.value },
                    }))}
                  />
                  {form.platform_cookies.xiaohongshu ? (
                    <p className="text-xs text-green-600 dark:text-green-400 mt-1">已配置</p>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">未配置，小红书账号扫描功能将不可用（单条链接抓取不受影响）</p>
                  )}
                </div>
              </div>
            </section>

            {/* Server */}
            <section>
              <h2 className="text-base font-semibold mb-4 pb-2 border-b border-border">服务器</h2>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">FastAPI 端口</label>
                  <Input
                    type="number"
                    min={1024}
                    max={65535}
                    value={form.fastapi_port}
                    onChange={(e) => setForm((f) => ({ ...f, fastapi_port: parseInt(e.target.value) || 8000 }))}
                    className="w-32"
                  />
                  <p className="text-xs text-muted-foreground mt-1">修改后需要重启后端服务才能生效</p>
                </div>
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

            {/* Build version & force refresh */}
            <div className="text-center pt-4 space-y-2">
              <p className="text-xs text-muted-foreground">
                构建时间: {__BUILD_TIME__}
              </p>
              <button
                className="text-xs text-muted-foreground underline hover:text-foreground transition-colors"
                onClick={async () => {
                  if ('serviceWorker' in navigator) {
                    const regs = await navigator.serviceWorker.getRegistrations()
                    await Promise.all(regs.map(r => r.unregister()))
                  }
                  if ('caches' in window) {
                    const keys = await caches.keys()
                    await Promise.all(keys.map(k => caches.delete(k)))
                  }
                  location.reload()
                }}
              >
                强制刷新缓存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TagManagement() {
  const { tags, fetchTags, createTag, updateTag, deleteTag, mergeTag } = useTagStore()
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [mergeSource, setMergeSource] = useState<string | null>(null)
  const [mergeTarget, setMergeTarget] = useState('')

  useEffect(() => { fetchTags() }, [fetchTags])

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name) return
    try {
      await createTag(name)
      setNewName('')
    } catch (err: any) {
      toast({ title: err.message || '创建标签失败', variant: 'destructive' })
    }
  }

  const handleRename = async (id: string) => {
    const name = editName.trim()
    if (!name) return
    try {
      await updateTag(id, { name })
      setEditingId(null)
    } catch (err: any) {
      toast({ title: err.message || '重命名失败', variant: 'destructive' })
    }
  }

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`确定要删除标签「${name}」吗？所有关联将被解除。`)) return
    try {
      await deleteTag(id)
    } catch (err: any) {
      toast({ title: err.message || '删除失败', variant: 'destructive' })
    }
  }

  const handleMerge = async () => {
    if (!mergeSource || !mergeTarget) return
    const sourceName = tags.find(t => t.id === mergeSource)?.name
    const targetName = tags.find(t => t.id === mergeTarget)?.name
    if (!window.confirm(`确定要将「${sourceName}」合并到「${targetName}」吗？原标签将被删除。`)) return
    try {
      await mergeTag(mergeSource, mergeTarget)
      setMergeSource(null)
      setMergeTarget('')
    } catch (err: any) {
      toast({ title: err.message || '合并失败', variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-base font-semibold mb-4 pb-2 border-b border-border">标签管理</h2>

        {/* Create new tag */}
        <div className="flex gap-2 mb-4">
          <Input
            className="flex-1"
            placeholder="新建标签..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
          <Button size="sm" onClick={handleCreate} disabled={!newName.trim()}>新建</Button>
        </div>

        {/* Tag list */}
        {tags.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">还没有标签</p>
        ) : (
          <div className="space-y-1">
            {tags.map((t) => (
              <div key={t.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:bg-muted/50 group">
                {editingId === t.id ? (
                  <Input
                    className="flex-1 h-7 text-sm"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleRename(t.id); if (e.key === 'Escape') setEditingId(null) }}
                    autoFocus
                  />
                ) : (
                  <span className="flex-1 text-sm font-medium">{t.name}</span>
                )}
                <span className="text-xs text-muted-foreground shrink-0">{t.person_count} 人物 · {t.album_count} 图集</span>
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  {editingId === t.id ? (
                    <>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleRename(t.id)}>
                        <Save className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingId(null)}>
                        <span className="text-xs">取消</span>
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditingId(t.id); setEditName(t.name) }}>
                        <Edit2 className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setMergeSource(t.id); setMergeTarget('') }}>
                        <Merge className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(t.id, t.name)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Merge dialog */}
      {mergeSource && (
        <Dialog open={!!mergeSource} onOpenChange={(v) => { if (!v) setMergeSource(null) }}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>合并标签</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">
              将「{tags.find(t => t.id === mergeSource)?.name}」的所有关联转移到目标标签，原标签将被删除。
            </p>
            <Select value={mergeTarget || 'none'} onValueChange={(v) => setMergeTarget(v === 'none' ? '' : v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="选择目标标签..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" disabled>选择目标标签...</SelectItem>
                {tags.filter(t => t.id !== mergeSource).map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DialogFooter>
              <Button variant="outline" onClick={() => setMergeSource(null)}>取消</Button>
              <Button onClick={handleMerge} disabled={!mergeTarget}>确认合并</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
