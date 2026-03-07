import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ClipboardPaste, Search, Download, RefreshCw, ExternalLink,
  User, ImagePlus, FolderOpen, Loader2, AlertCircle, CheckCircle2, Play, X, Paintbrush,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/hooks/use-toast'
import { useDownloadStore } from '@/stores/download'
import { usePersonStore } from '@/stores/person'
import { useWorkflowStore } from '@/stores/workflow'
import { workflowsApi, WorkflowFull } from '@/api/workflows'
import { albumsApi, Album } from '@/api/albums'
import { cn } from '@/lib/utils'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FaceRefPicker } from '@/components/FaceRefPicker'
import { MaskEditor } from '@/components/MaskEditor'
import { mediaApi, MediaItem } from '@/api/media'
import type { ConfirmRequest, ParseResult } from '@/api/downloads'

type Tab = 'scraper' | 'records' | 'ai-tools'

export function Tools() {
  const [activeTab, setActiveTab] = useState<Tab>('scraper')

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="border-b border-border shrink-0">
        <div className="flex items-center gap-4 px-4 h-14 max-w-2xl mx-auto">
          <h1 className="text-lg font-semibold">小工具</h1>
          <div className="flex gap-1 bg-muted rounded-md p-0.5">
            <button
              className={cn(
                'px-3 py-1 text-sm rounded transition-colors',
                activeTab === 'scraper' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setActiveTab('scraper')}
            >
              网页抓取
            </button>
            <button
              className={cn(
                'px-3 py-1 text-sm rounded transition-colors',
                activeTab === 'records' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setActiveTab('records')}
            >
              下载记录
            </button>
            <button
              className={cn(
                'px-3 py-1 text-sm rounded transition-colors',
                activeTab === 'ai-tools' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setActiveTab('ai-tools')}
            >
              AI 工具
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'scraper' ? <ScraperTab /> : activeTab === 'records' ? <RecordsTab /> : <AiToolsTab />}
      </div>
    </div>
  )
}

// ── Scraper Tab ─────────────────────────────────────────────────────────────

function ScraperTab() {
  const navigate = useNavigate()
  const { parseResult, parsing, parseError, downloading, parseUrl, clearParseResult, confirmDownload } = useDownloadStore()
  const { persons, fetchPersons } = usePersonStore()

  const [rawText, setRawText] = useState('')
  const [personMode, setPersonMode] = useState<'none' | 'existing' | 'new'>('none')
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null)
  const [newPersonName, setNewPersonName] = useState('')
  const [albumMode, setAlbumMode] = useState<'new' | 'existing' | 'loose'>('new')
  const [albumName, setAlbumName] = useState('')
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null)
  const [rememberAccount, setRememberAccount] = useState(true)
  const [personAlbums, setPersonAlbums] = useState<Album[]>([])

  useEffect(() => {
    fetchPersons()
  }, [fetchPersons])

  // When parse result arrives, pre-fill fields
  useEffect(() => {
    if (parseResult) {
      setAlbumName(parseResult.title || '')
      setNewPersonName(parseResult.display_name || parseResult.username || '')
      if (parseResult.existing_account?.person_id) {
        setPersonMode('existing')
        setSelectedPersonId(parseResult.existing_account.person_id)
      } else {
        // New account — default to "new person" mode with display_name pre-filled
        setPersonMode('new')
      }
    }
  }, [parseResult])

  // Load albums when person changes
  useEffect(() => {
    if (selectedPersonId && personMode === 'existing') {
      albumsApi.listByPerson(selectedPersonId).then(setPersonAlbums).catch(() => setPersonAlbums([]))
    } else {
      setPersonAlbums([])
    }
  }, [selectedPersonId, personMode])

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) setRawText(text)
    } catch {
      toast({ title: '无法读取剪贴板', description: '请手动粘贴', variant: 'destructive' })
    }
  }, [])

  const handleParse = useCallback(async () => {
    if (!rawText.trim()) return
    try {
      await parseUrl(rawText)
    } catch (e: any) {
      toast({ title: '解析失败', description: e.message, variant: 'destructive' })
    }
  }, [rawText, parseUrl])

  const handleConfirm = useCallback(async () => {
    if (!parseResult) return
    const body: ConfirmRequest = {
      platform: parseResult.platform,
      source_url: parseResult.source_url,
      username: parseResult.username,
      display_name: parseResult.display_name,
      title: parseResult.title,
      published_at: parseResult.published_at,
      media_items: parseResult.media_items,
      person_id: personMode === 'existing' ? selectedPersonId : null,
      create_person_name: personMode === 'new' ? newPersonName : null,
      album_mode: albumMode,
      album_name: albumMode === 'new' ? (albumName || parseResult.title) : null,
      existing_album_id: albumMode === 'existing' ? selectedAlbumId : null,
      remember_account: rememberAccount,
    }
    try {
      const result = await confirmDownload(body)
      toast({ title: '下载完成', description: `已下载 ${result.media_count} 个文件` })
      if (result.album_id) {
        navigate(`/albums/${result.album_id}`)
      } else if (result.person_id) {
        navigate(`/persons/${result.person_id}`)
      }
    } catch (e: any) {
      toast({ title: '下载失败', description: e.message, variant: 'destructive' })
    }
  }, [parseResult, personMode, selectedPersonId, newPersonName, albumMode, albumName, selectedAlbumId, rememberAccount, confirmDownload, navigate])

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      {/* Input area */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-foreground">粘贴链接或分享文本</label>
        <textarea
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
          rows={3}
          placeholder="粘贴小红书分享链接或文本..."
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
        />
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handlePaste} className="gap-1.5">
            <ClipboardPaste className="w-4 h-4" />
            粘贴剪贴板
          </Button>
          <Button size="sm" onClick={handleParse} disabled={parsing || !rawText.trim()} className="gap-1.5">
            {parsing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            解析
          </Button>
        </div>
        {parseError && (
          <div className="text-sm text-destructive flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {parseError}
          </div>
        )}
      </div>

      {/* Parse result preview */}
      {parseResult && (
        <>
          <div className="border border-border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">解析结果</h3>
              <PlatformBadge platform={parseResult.platform} />
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <User className="w-3.5 h-3.5" />
                <span>{parseResult.display_name || parseResult.username}</span>
              </div>
              {parseResult.title && (
                <p className="text-foreground">{parseResult.title}</p>
              )}
              {parseResult.published_at && (
                <p className="text-xs text-muted-foreground">
                  {new Date(parseResult.published_at).toLocaleDateString('zh-CN')}
                </p>
              )}
            </div>

            {/* Media preview grid */}
            {parseResult.media_items.length > 0 && (
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                {parseResult.media_items.slice(0, 12).map((item, i) => (
                  <div key={i} className="aspect-square rounded bg-muted overflow-hidden">
                    <img
                      src={item.thumb_url || item.url}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              共 {parseResult.media_items.filter(m => m.type === 'image').length} 张图片
              {parseResult.media_items.some(m => m.type === 'video') &&
                ` / ${parseResult.media_items.filter(m => m.type === 'video').length} 个视频`}
            </p>
          </div>

          {/* Association settings */}
          <div className="border border-border rounded-lg p-4 space-y-4">
            <h3 className="text-sm font-medium">关联设置</h3>

            {/* Person picker */}
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">关联人物</label>
              <div className="flex gap-1.5 flex-wrap">
                {(['none', 'existing', 'new'] as const).map((mode) => (
                  <button
                    key={mode}
                    className={cn(
                      'px-3 py-1 text-xs rounded-full border transition-colors',
                      personMode === mode
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    )}
                    onClick={() => setPersonMode(mode)}
                  >
                    {mode === 'none' ? '不关联' : mode === 'existing' ? '已有人物' : '新建人物'}
                  </button>
                ))}
              </div>
              {personMode === 'existing' && (
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                  value={selectedPersonId || ''}
                  onChange={(e) => setSelectedPersonId(e.target.value || null)}
                >
                  <option value="">选择人物...</option>
                  {persons.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              )}
              {personMode === 'new' && (
                <input
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                  placeholder="输入人物名称"
                  value={newPersonName}
                  onChange={(e) => setNewPersonName(e.target.value)}
                />
              )}
            </div>

            {/* Remember account */}
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={rememberAccount}
                onChange={(e) => setRememberAccount(e.target.checked)}
                className="rounded border-input"
              />
              记住此账号的关联关系
            </label>

            {/* Album mode */}
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">图集归属</label>
              <div className="flex gap-1.5 flex-wrap">
                {(['new', 'existing', 'loose'] as const).map((mode) => (
                  <button
                    key={mode}
                    className={cn(
                      'px-3 py-1 text-xs rounded-full border transition-colors',
                      albumMode === mode
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    )}
                    onClick={() => setAlbumMode(mode)}
                  >
                    {mode === 'new' ? '新建图集' : mode === 'existing' ? '已有图集' : '散图'}
                  </button>
                ))}
              </div>
              {albumMode === 'new' && (
                <input
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                  placeholder="图集名称"
                  value={albumName}
                  onChange={(e) => setAlbumName(e.target.value)}
                />
              )}
              {albumMode === 'existing' && (
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                  value={selectedAlbumId || ''}
                  onChange={(e) => setSelectedAlbumId(e.target.value || null)}
                >
                  <option value="">选择图集...</option>
                  {personAlbums.map((a) => (
                    <option key={a.id} value={a.id}>{a.name} ({a.media_count})</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Confirm button */}
          <div className="sticky bottom-4">
            <Button
              className="w-full gap-1.5"
              size="lg"
              onClick={handleConfirm}
              disabled={downloading || (personMode === 'new' && !newPersonName.trim())}
            >
              {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              确认下载 ({parseResult.media_count} 个文件)
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

// ── Records Tab ─────────────────────────────────────────────────────────────

function RecordsTab() {
  const navigate = useNavigate()
  const { records, recordsLoading, fetchRecords, retryRecord } = useDownloadStore()

  useEffect(() => {
    fetchRecords()
  }, [fetchRecords])

  const handleRetry = useCallback(async (id: string) => {
    try {
      await retryRecord(id)
      toast({ title: '重试成功' })
    } catch (e: any) {
      toast({ title: '重试失败', description: e.message, variant: 'destructive' })
    }
  }, [retryRecord])

  if (recordsLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        加载中...
      </div>
    )
  }

  if (records.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2">
        <Download className="w-8 h-8 opacity-50" />
        <p className="text-sm">暂无下载记录</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-2">
      {records.map((r) => (
        <div
          key={r.id}
          className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-accent/50 transition-colors"
        >
          <PlatformBadge platform={r.platform} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{r.title || r.source_url}</p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {r.account_username && <span>{r.account_username}</span>}
              <span>{new Date(r.downloaded_at).toLocaleDateString('zh-CN')}</span>
              <span>{r.media_count} 个文件</span>
            </div>
            {r.status === 'failed' && r.error_message && (
              <p className="text-xs text-destructive mt-0.5 truncate">{r.error_message}</p>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <StatusBadge status={r.status} />
            {r.status === 'failed' && (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleRetry(r.id)}>
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
            )}
            {r.album_id && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => navigate(`/albums/${r.album_id}`)}
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── AI Tools Tab ────────────────────────────────────────────────────────────

function isMaskParam(p: { type: string; source?: string }) {
  return p.type === 'image' && p.source === 'file_path'
}

function AiToolsTab() {
  const { categories, workflows, fetchCategories, fetchWorkflows } = useWorkflowStore()
  const [selectedId, setSelectedId] = useState<string>('')
  const [workflowDetail, setWorkflowDetail] = useState<WorkflowFull | null>(null)
  const [params, setParams] = useState<Record<string, any>>({})
  const [running, setRunning] = useState(false)
  const [pickerParam, setPickerParam] = useState<string | null>(null)
  const [mediaThumbs, setMediaThumbs] = useState<Record<string, string>>({})
  const [selectedMedia, setSelectedMedia] = useState<Record<string, MediaItem>>({})
  const [maskEditorOpen, setMaskEditorOpen] = useState(false)
  const [maskParam, setMaskParam] = useState<string | null>(null)
  const [maskPreview, setMaskPreview] = useState<Record<string, string>>({})

  useEffect(() => {
    fetchCategories()
    fetchWorkflows()
  }, [fetchCategories, fetchWorkflows])

  useEffect(() => {
    if (!selectedId) { setWorkflowDetail(null); setParams({}); return }
    workflowsApi.get(selectedId).then(wf => {
      setWorkflowDetail(wf)
      // Extract default values from workflow JSON via manifest mappings
      const defaults: Record<string, any> = {}
      if (wf.manifest?.mappings) {
        for (const [paramName, mapping] of Object.entries(wf.manifest.mappings)) {
          if (mapping.type === 'image') continue
          const nodeData = wf.workflow_json?.[mapping.node_id]
          if (nodeData?.inputs?.[mapping.key] !== undefined) {
            const val = nodeData.inputs[mapping.key]
            if (!Array.isArray(val)) defaults[paramName] = val
          }
        }
      }
      // Also extract defaults for extra_params
      if (wf.manifest?.extra_params) {
        for (const ep of wf.manifest.extra_params) {
          const nodeData = wf.workflow_json?.[ep.node_id]
          if (nodeData?.inputs?.[ep.key] !== undefined) {
            const val = nodeData.inputs[ep.key]
            if (!Array.isArray(val)) defaults[ep.name] = val
          }
        }
      }
      setParams(defaults)
      setSelectedMedia({})
      setMaskPreview(prev => {
        Object.values(prev).forEach(url => URL.revokeObjectURL(url))
        return {}
      })
    }).catch(() => setWorkflowDetail(null))
  }, [selectedId])

  const selectedCategory = workflowDetail
    ? categories.find(c => c.key === workflowDetail.category)
    : null

  // Get the base image for mask drawing
  const getMaskBaseMedia = useCallback((): MediaItem | null => {
    if (!selectedCategory) return null
    const imageParams = selectedCategory.params.filter(p => p.type === 'image' && !isMaskParam(p) && params[p.name])
    for (const p of imageParams) {
      if (selectedMedia[p.name]) return selectedMedia[p.name]
    }
    return null
  }, [selectedCategory, params, selectedMedia])

  // Handle mask drawing complete
  const handleMaskComplete = useCallback(async (blob: Blob) => {
    setMaskEditorOpen(false)
    if (!maskParam) return
    const baseMedia = getMaskBaseMedia()
    if (!baseMedia) return

    try {
      const form = new FormData()
      form.append('file', blob, 'mask.png')
      const http = (await import('@/api/http')).default
      const { data: maskResult } = await http.post<{ mask_path: string }>(
        `/media/${baseMedia.id}/upload-mask`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      )
      setParams(prev => ({ ...prev, [maskParam]: maskResult.mask_path }))
      const previewUrl = URL.createObjectURL(blob)
      setMaskPreview(prev => {
        if (prev[maskParam]) URL.revokeObjectURL(prev[maskParam])
        return { ...prev, [maskParam]: previewUrl }
      })
    } catch (err: any) {
      toast({ title: '遮罩上传失败', description: err.message, variant: 'destructive' })
    }
  }, [maskParam, getMaskBaseMedia])

  // Group workflows by category
  const grouped = workflows.reduce<Record<string, typeof workflows>>((acc, wf) => {
    (acc[wf.category] ||= []).push(wf)
    return acc
  }, {})

  const handleRun = useCallback(async () => {
    if (!workflowDetail) return
    setRunning(true)
    try {
      // Create a task via the tasks API
      const http = (await import('@/api/http')).default
      const res = await http.post('/tasks', {
        workflow_type: `custom:${workflowDetail.id}`,
        params: { workflow_id: workflowDetail.id, ...params },
        execution_mode: 'immediate',
      })
      toast({ title: '任务已创建', description: `任务 ID: ${res.data.id}` })
    } catch (e: any) {
      toast({ title: '创建任务失败', description: e.message, variant: 'destructive' })
    } finally {
      setRunning(false)
    }
  }, [workflowDetail, params])

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      {/* Workflow selector */}
      <div className="space-y-3">
        <label className="text-sm font-medium">选择工作流</label>
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger>
            <SelectValue placeholder="选择一个工作流..." />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(grouped).map(([catKey, wfs]) => {
              const catLabel = categories.find(c => c.key === catKey)?.label || catKey
              return wfs.map(wf => (
                <SelectItem key={wf.id} value={wf.id}>
                  [{catLabel}] {wf.name}
                </SelectItem>
              ))
            })}
          </SelectContent>
        </Select>
      </div>

      {/* Workflow description */}
      {workflowDetail?.description && (
        <p className="text-sm text-muted-foreground">{workflowDetail.description}</p>
      )}

      {/* Dynamic param form */}
      {selectedCategory && workflowDetail && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium">参数</h3>
          {selectedCategory.params.map(param => (
            <div key={param.name} className="space-y-1">
              <label className="text-sm text-muted-foreground">
                {param.label}
                {param.required && <span className="text-destructive ml-0.5">*</span>}
              </label>
              {isMaskParam(param) ? (
                /* Mask param — MaskEditor */
                params[param.name] ? (
                  <div className="flex items-center gap-2">
                    {maskPreview[param.name] && (
                      <img
                        src={maskPreview[param.name]}
                        alt="遮罩预览"
                        className="w-16 h-16 rounded border object-contain bg-neutral-900 shrink-0"
                      />
                    )}
                    <div className="flex-1 flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setMaskParam(param.name); setMaskEditorOpen(true) }}
                      >
                        <Paintbrush className="w-4 h-4 mr-1" />
                        重新绘制
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setParams(prev => { const { [param.name]: _, ...rest } = prev; return rest })
                          setMaskPreview(prev => {
                            if (prev[param.name]) URL.revokeObjectURL(prev[param.name])
                            const { [param.name]: _, ...rest } = prev
                            return rest
                          })
                        }}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-1.5"
                    disabled={!getMaskBaseMedia()}
                    onClick={() => { setMaskParam(param.name); setMaskEditorOpen(true) }}
                  >
                    <Paintbrush className="w-4 h-4" />
                    {getMaskBaseMedia() ? '绘制遮罩' : '请先选择原图'}
                  </Button>
                )
              ) : param.type === 'image' ? (
                <div className="flex items-center gap-2">
                  {params[param.name] ? (
                    <div className="flex items-center gap-2 flex-1 min-w-0 bg-muted rounded-md px-2 py-1.5">
                      {mediaThumbs[param.name] && (
                        <img
                          src={mediaThumbs[param.name]}
                          alt=""
                          className="w-8 h-8 rounded object-cover shrink-0"
                        />
                      )}
                      <span className="text-sm truncate flex-1">{params[param.name]}</span>
                      <button
                        className="text-muted-foreground hover:text-foreground shrink-0"
                        onClick={() => {
                          setParams(prev => { const { [param.name]: _, ...rest } = prev; return rest })
                          setMediaThumbs(prev => { const { [param.name]: _, ...rest } = prev; return rest })
                          setSelectedMedia(prev => { const { [param.name]: _, ...rest } = prev; return rest })
                        }}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full gap-1.5"
                      onClick={() => setPickerParam(param.name)}
                    >
                      <ImagePlus className="w-4 h-4" />
                      选择图片
                    </Button>
                  )}
                </div>
              ) : param.type === 'string' ? (
                <textarea
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                  rows={2}
                  placeholder={param.label}
                  value={params[param.name] ?? ''}
                  onChange={e => setParams(prev => ({ ...prev, [param.name]: e.target.value }))}
                />
              ) : (
                <Input
                  type="number"
                  step={param.type === 'float' ? '0.01' : '1'}
                  placeholder={param.label}
                  value={params[param.name] ?? ''}
                  onChange={e => {
                    const v = param.type === 'float' ? parseFloat(e.target.value) : parseInt(e.target.value)
                    setParams(prev => ({ ...prev, [param.name]: isNaN(v) ? '' : v }))
                  }}
                />
              )}
            </div>
          ))}

          {/* Extra params from manifest */}
          {workflowDetail.manifest?.extra_params && workflowDetail.manifest.extra_params.length > 0 && (
            <>
              <div className="border-t border-border pt-3 mt-1">
                <p className="text-xs text-muted-foreground mb-3">额外参数</p>
              </div>
              {workflowDetail.manifest.extra_params.map(ep => (
                <div key={ep.name} className="space-y-1">
                  <label className="text-sm text-muted-foreground">{ep.label || ep.name}</label>
                  {ep.type === 'string' ? (
                    <textarea
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                      rows={2}
                      placeholder={ep.label || ep.name}
                      value={params[ep.name] ?? ''}
                      onChange={e => setParams(prev => ({ ...prev, [ep.name]: e.target.value }))}
                    />
                  ) : ep.type === 'bool' ? (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!params[ep.name]}
                        onChange={e => setParams(prev => ({ ...prev, [ep.name]: e.target.checked }))}
                        className="rounded border-input"
                      />
                      <span className="text-sm">{params[ep.name] ? '是' : '否'}</span>
                    </label>
                  ) : (
                    <Input
                      type="number"
                      step={ep.type === 'float' ? '0.01' : '1'}
                      placeholder={ep.label || ep.name}
                      value={params[ep.name] ?? ''}
                      onChange={e => {
                        const v = ep.type === 'float' ? parseFloat(e.target.value) : parseInt(e.target.value)
                        setParams(prev => ({ ...prev, [ep.name]: isNaN(v) ? '' : v }))
                      }}
                    />
                  )}
                </div>
              ))}
            </>
          )}

          <Button className="w-full gap-1.5" onClick={handleRun} disabled={running}>
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            运行
          </Button>
        </div>
      )}

      {!selectedId && (
        <div className="text-center py-12 text-muted-foreground text-sm">
          选择一个工作流开始使用
        </div>
      )}

      <FaceRefPicker
        open={!!pickerParam}
        onOpenChange={(v) => { if (!v) setPickerParam(null) }}
        title={pickerParam ? `选择图片 — ${selectedCategory?.params.find(p => p.name === pickerParam)?.label || pickerParam}` : '选择图片'}
        onSelect={(media) => {
          if (pickerParam) {
            setParams(prev => ({ ...prev, [pickerParam]: media.id }))
            setMediaThumbs(prev => ({
              ...prev,
              [pickerParam]: `/api/files/thumb?path=${encodeURIComponent(media.file_path)}&size=100`,
            }))
            setSelectedMedia(prev => ({ ...prev, [pickerParam]: media as unknown as MediaItem }))
          }
          setPickerParam(null)
        }}
      />

      <MaskEditor
        open={maskEditorOpen}
        onClose={() => setMaskEditorOpen(false)}
        media={getMaskBaseMedia()}
        onComplete={handleMaskComplete}
      />
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function PlatformBadge({ platform }: { platform: string }) {
  const labels: Record<string, string> = {
    xiaohongshu: '小红书',
    bilibili: 'B站',
    twitter: 'X',
    telegram: 'TG',
  }
  return (
    <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded bg-primary/10 text-primary">
      {labels[platform] || platform}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'completed') {
    return <CheckCircle2 className="w-4 h-4 text-green-500" />
  }
  if (status === 'failed') {
    return <AlertCircle className="w-4 h-4 text-destructive" />
  }
  return <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
}
