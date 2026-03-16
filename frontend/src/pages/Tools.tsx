import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ClipboardPaste, Search, Download, RefreshCw, ExternalLink,
  User, Loader2, AlertCircle, CheckCircle2, ScanLine, X,
  Image as ImageIcon, FolderOpen,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { useDownloadStore } from '@/stores/download'
import { usePersonStore } from '@/stores/person'
import { albumsApi, Album } from '@/api/albums'
import { cn } from '@/lib/utils'
import type { ConfirmRequest, ParseResult, BatchConfirmRequest, ScanJobStatus } from '@/api/downloads'

type Tab = 'scraper' | 'records'

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
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto pb-28 md:pb-4">
        {activeTab === 'scraper' ? <ScraperTab /> : <RecordsTab />}
      </div>
    </div>
  )
}

// ── Scraper Tab ─────────────────────────────────────────────────────────────

function ScraperTab() {
  const navigate = useNavigate()
  const {
    parseResult, parsing, parseError, downloading, parseUrl, clearParseResult, confirmDownload,
    scanJob, scanning, startScan, confirmBatch, cancelScan, clearScanJob,
  } = useDownloadStore()
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

  // Batch scan state
  const [batchPersonMode, setBatchPersonMode] = useState<'none' | 'existing' | 'new'>('none')
  const [batchSelectedPersonId, setBatchSelectedPersonId] = useState<string | null>(null)
  const [batchNewPersonName, setBatchNewPersonName] = useState('')
  const [batchAlbumMode, setBatchAlbumMode] = useState<'per_note' | 'loose'>('per_note')
  const [batchRememberAccount, setBatchRememberAccount] = useState(true)

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

  // Pre-fill batch person settings from parse result
  useEffect(() => {
    if (scanJob?.status === 'scan_complete' && parseResult) {
      setBatchNewPersonName(parseResult.display_name || parseResult.username || '')
      if (parseResult.existing_account?.person_id) {
        setBatchPersonMode('existing')
        setBatchSelectedPersonId(parseResult.existing_account.person_id)
      } else {
        setBatchPersonMode('new')
      }
    }
  }, [scanJob?.status, parseResult])

  const handleStartScan = useCallback(async () => {
    if (!parseResult) return
    const platform = parseResult.platform
    // For douyin, use sec_uid from extra; for xiaohongshu use username
    const username = parseResult.extra?.sec_uid || parseResult.username
    try {
      await startScan(platform, username, parseResult.display_name)
    } catch (e: any) {
      toast({ title: '扫描失败', description: e.message, variant: 'destructive' })
    }
  }, [parseResult, startScan])

  const handleBatchConfirm = useCallback(async () => {
    if (!scanJob) return
    const body: BatchConfirmRequest = {
      job_id: scanJob.job_id,
      person_id: batchPersonMode === 'existing' ? batchSelectedPersonId : null,
      create_person_name: batchPersonMode === 'new' ? batchNewPersonName : null,
      album_mode: batchAlbumMode,
      remember_account: batchRememberAccount,
    }
    try {
      await confirmBatch(body)
      toast({ title: '开始批量下载', description: `共 ${scanJob.total_notes} 个笔记` })
    } catch (e: any) {
      toast({ title: '批量下载失败', description: e.message, variant: 'destructive' })
    }
  }, [scanJob, batchPersonMode, batchSelectedPersonId, batchNewPersonName, batchAlbumMode, batchRememberAccount, confirmBatch])

  const handleCancelScan = useCallback(async () => {
    try {
      await cancelScan()
      toast({ title: '已取消' })
    } catch (e: any) {
      toast({ title: '取消失败', description: e.message, variant: 'destructive' })
    }
  }, [cancelScan])

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
          placeholder="粘贴小红书/抖音分享链接或文本..."
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
            {parseResult.existing_download && (
              <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded px-2.5 py-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>
                  该链接已于 {new Date(parseResult.existing_download.downloaded_at).toLocaleDateString('zh-CN')} 下载过
                  （{parseResult.existing_download.media_count} 个文件），再次下载将创建新的副本
                </span>
                {parseResult.existing_download.album_id && (
                  <button
                    className="ml-1 underline hover:no-underline shrink-0"
                    onClick={() => navigate(`/albums/${parseResult.existing_download!.album_id}`)}
                  >
                    查看
                  </button>
                )}
              </div>
            )}
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
                    {mode === 'new' ? '新建图集' : mode === 'existing' ? '已有图集' : '未分类'}
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
          <div className="sticky bottom-4 space-y-2">
            <Button
              className="w-full gap-1.5"
              size="lg"
              onClick={handleConfirm}
              disabled={downloading || (personMode === 'new' && !newPersonName.trim())}
            >
              {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              确认下载 ({parseResult.media_count} 个文件)
            </Button>
            {/* Scan all notes button — only for platforms with account scanning */}
            {!scanJob && (parseResult.platform === 'douyin' || parseResult.platform === 'xiaohongshu') && (
              <Button
                variant="outline"
                className="w-full gap-1.5"
                size="lg"
                onClick={handleStartScan}
                disabled={scanning}
              >
                {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />}
                扫描该账号所有图文笔记
              </Button>
            )}
          </div>
        </>
      )}

      {/* ── Batch Scan UI ──────────────────────────────────────────── */}
      {scanJob && <BatchScanPanel
        scanJob={scanJob}
        scanning={scanning}
        persons={persons}
        personMode={batchPersonMode}
        setPersonMode={setBatchPersonMode}
        selectedPersonId={batchSelectedPersonId}
        setSelectedPersonId={setBatchSelectedPersonId}
        newPersonName={batchNewPersonName}
        setNewPersonName={setBatchNewPersonName}
        albumMode={batchAlbumMode}
        setAlbumMode={setBatchAlbumMode}
        rememberAccount={batchRememberAccount}
        setRememberAccount={setBatchRememberAccount}
        onConfirm={handleBatchConfirm}
        onCancel={handleCancelScan}
        onClear={clearScanJob}
      />}
    </div>
  )
}

// ── Batch Scan Panel ────────────────────────────────────────────────────────

interface BatchScanPanelProps {
  scanJob: ScanJobStatus
  scanning: boolean
  persons: { id: string; name: string }[]
  personMode: 'none' | 'existing' | 'new'
  setPersonMode: (m: 'none' | 'existing' | 'new') => void
  selectedPersonId: string | null
  setSelectedPersonId: (id: string | null) => void
  newPersonName: string
  setNewPersonName: (n: string) => void
  albumMode: 'per_note' | 'loose'
  setAlbumMode: (m: 'per_note' | 'loose') => void
  rememberAccount: boolean
  setRememberAccount: (b: boolean) => void
  onConfirm: () => void
  onCancel: () => void
  onClear: () => void
}

function BatchScanPanel({
  scanJob, scanning, persons,
  personMode, setPersonMode, selectedPersonId, setSelectedPersonId,
  newPersonName, setNewPersonName, albumMode, setAlbumMode,
  rememberAccount, setRememberAccount,
  onConfirm, onCancel, onClear,
}: BatchScanPanelProps) {
  const isScanning = scanJob.status === 'scanning'
  const isScanComplete = scanJob.status === 'scan_complete'
  const isDownloading = scanJob.status === 'downloading'
  const isCompleted = scanJob.status === 'completed'
  const isFailed = scanJob.status === 'failed'
  const isCancelled = scanJob.status === 'cancelled'
  const isDone = isCompleted || isFailed || isCancelled

  return (
    <div className="border border-border rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-1.5">
          <ScanLine className="w-4 h-4" />
          批量扫描 · {scanJob.display_name}
        </h3>
        {isDone && (
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClear}>
            <X className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      {/* Scanning in progress */}
      {isScanning && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          正在扫描账号笔记...
        </div>
      )}

      {/* Scan complete — show results and confirm UI */}
      {isScanComplete && (
        <>
          <div className="flex items-center gap-4 text-sm flex-wrap">
            <div className="flex items-center gap-1.5">
              <FolderOpen className="w-4 h-4 text-muted-foreground" />
              <span className="font-medium">{scanJob.total_notes}</span>
              <span className="text-muted-foreground">个新笔记</span>
            </div>
            <div className="flex items-center gap-1.5">
              <ImageIcon className="w-4 h-4 text-muted-foreground" />
              <span className="font-medium">{scanJob.total_media}</span>
              <span className="text-muted-foreground">张图片</span>
            </div>
            {scanJob.skipped_notes > 0 && (
              <span className="text-xs text-muted-foreground">（已跳过 {scanJob.skipped_notes} 个已下载笔记）</span>
            )}
          </div>

          {/* Note preview list (collapsible) */}
          {scanJob.notes && scanJob.notes.length > 0 && (
            <NotePreviewList notes={scanJob.notes} />
          )}

          {/* Batch association settings */}
          <div className="space-y-3 pt-2 border-t border-border">
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

            <label className="text-sm text-muted-foreground">图集归属</label>
            <div className="flex gap-1.5 flex-wrap">
              {(['per_note', 'loose'] as const).map((mode) => (
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
                  {mode === 'per_note' ? '每个笔记一个图集' : '全部未分类'}
                </button>
              ))}
            </div>

            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={rememberAccount}
                onChange={(e) => setRememberAccount(e.target.checked)}
                className="rounded border-input"
              />
              记住此账号的关联关系
            </label>
          </div>

          {scanJob.total_notes > 0 ? (
            <div className="flex gap-2">
              <Button className="flex-1 gap-1.5" onClick={onConfirm}>
                <Download className="w-4 h-4" />
                开始批量下载 ({scanJob.total_notes} 个笔记)
              </Button>
              <Button variant="outline" onClick={onCancel}>取消</Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <p className="text-sm text-muted-foreground">所有笔记都已下载过，没有新内容</p>
              <Button variant="outline" size="sm" onClick={onClear}>关闭</Button>
            </div>
          )}
        </>
      )}

      {/* Downloading in progress */}
      {isDownloading && (
        <>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">下载进度</span>
              <span className="font-medium">
                {scanJob.completed_notes + scanJob.failed_notes} / {scanJob.total_notes} 笔记
              </span>
            </div>
            <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
              <div
                className="bg-primary h-full rounded-full transition-all duration-300"
                style={{ width: `${scanJob.total_notes > 0 ? ((scanJob.completed_notes + scanJob.failed_notes) / scanJob.total_notes) * 100 : 0}%` }}
              />
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>已下载 {scanJob.downloaded_media} 张图片</span>
              {scanJob.failed_notes > 0 && (
                <span className="text-destructive">{scanJob.failed_notes} 个失败</span>
              )}
            </div>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={onCancel}>
            <X className="w-3.5 h-3.5" />
            取消下载
          </Button>
        </>
      )}

      {/* Completed */}
      {isCompleted && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
            <CheckCircle2 className="w-4 h-4" />
            批量下载完成：{scanJob.completed_notes} 个笔记，{scanJob.downloaded_media} 张图片
            {scanJob.failed_notes > 0 && (
              <span className="text-destructive">（{scanJob.failed_notes} 个失败）</span>
            )}
          </div>
          {scanJob.failed_notes > 0 && scanJob.error && (
            <div className="text-xs text-muted-foreground ml-6">{scanJob.error}</div>
          )}
        </div>
      )}

      {/* Failed */}
      {isFailed && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="w-4 h-4" />
          {scanJob.error || '扫描失败'}
        </div>
      )}

      {/* Cancelled */}
      {isCancelled && (
        <div className="text-sm text-muted-foreground">
          已取消。已完成 {scanJob.completed_notes} 个笔记，{scanJob.downloaded_media} 张图片。
        </div>
      )}
    </div>
  )
}

// ── Note Preview List ───────────────────────────────────────────────────────

function NotePreviewList({ notes }: { notes: NonNullable<import('@/api/downloads').ScanJobStatus['notes']> }) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? notes : notes.slice(0, 4)

  return (
    <div className="space-y-1.5">
      {shown.map((note) => (
        <div key={note.note_id} className="flex items-center gap-2 text-xs">
          {note.cover_url ? (
            <img
              src={note.cover_url}
              alt=""
              className="w-8 h-8 rounded object-cover shrink-0 bg-muted"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-8 h-8 rounded bg-muted shrink-0" />
          )}
          <span className="truncate flex-1 text-foreground">{note.title}</span>
          <span className="text-muted-foreground shrink-0">{note.media_count} 张</span>
        </div>
      ))}
      {notes.length > 4 && (
        <button
          className="text-xs text-primary hover:underline"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? '收起' : `查看全部 ${notes.length} 个笔记`}
        </button>
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

// ── Helpers ─────────────────────────────────────────────────────────────────

function PlatformBadge({ platform }: { platform: string }) {
  const labels: Record<string, string> = {
    xiaohongshu: '小红书',
    douyin: '抖音',
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
