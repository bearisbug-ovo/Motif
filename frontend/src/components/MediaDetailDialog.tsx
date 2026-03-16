import { useState, useEffect, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Copy, Check, AlertTriangle, FileSearch } from 'lucide-react'
import { MediaItem, mediaApi } from '@/api/media'
import { systemApi } from '@/api/system'
import { downloadApi, DownloadInfo } from '@/api/downloads'
import { toast } from '@/hooks/use-toast'

interface MediaDetailDialogProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  item: MediaItem | null
  isMissing?: boolean
  onRelocated?: (updated: MediaItem) => void
}

export function MediaDetailDialog({ open, onOpenChange, item, isMissing: isMissingProp, onRelocated }: MediaDetailDialogProps) {
  const [videoDuration, setVideoDuration] = useState<number | null>(null)
  const [downloadInfo, setDownloadInfo] = useState<DownloadInfo | null>(null)
  const [relocating, setRelocating] = useState(false)
  const [checkedMissing, setCheckedMissing] = useState<boolean | null>(null)

  // Auto-detect missing file when dialog opens (if not provided via prop)
  useEffect(() => {
    if (!open || !item || isMissingProp !== undefined) {
      setCheckedMissing(null)
      return
    }
    if (item.source_type !== 'local') { setCheckedMissing(false); return }
    mediaApi.checkFiles([item.id])
      .then(({ missing }) => setCheckedMissing(missing.includes(item.id)))
      .catch(() => setCheckedMissing(null))
  }, [open, item?.id, isMissingProp])

  const isMissing = isMissingProp ?? checkedMissing ?? false

  const handleRelocate = useCallback(async () => {
    if (!item) return
    setRelocating(true)
    try {
      const { paths } = await systemApi.pickFiles()
      if (paths.length === 0) { setRelocating(false); return }
      const updated = await mediaApi.relocate(item.id, paths[0])
      toast({ title: '文件已重新定位' })
      onRelocated?.(updated)
    } catch (err: any) {
      toast({ title: '重新定位失败', description: err.message, variant: 'destructive' })
    }
    setRelocating(false)
  }, [item, onRelocated])

  useEffect(() => {
    if (!open || !item || item.media_type !== 'video') {
      setVideoDuration(null)
      return
    }
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.src = mediaApi.serveUrl(item.file_path)
    video.onloadedmetadata = () => {
      setVideoDuration(video.duration)
      video.src = ''
    }
    video.onerror = () => setVideoDuration(null)
    return () => { video.src = '' }
  }, [open, item])

  useEffect(() => {
    if (!open || !item) {
      setDownloadInfo(null)
      return
    }
    if (item.album_id) {
      downloadApi.getInfoByAlbum(item.album_id).then(setDownloadInfo).catch(() => setDownloadInfo(null))
    } else {
      setDownloadInfo(null)
    }
  }, [open, item])

  if (!item) return null

  const fileName = item.file_path.replace(/^.*[\\/]/, '')
  const dirPath = item.file_path.replace(/[\\/][^\\/]+$/, '')
  const ext = fileName.match(/\.([^.]+)$/)?.[1]?.toUpperCase() || ''

  const rows: { label: string; value: string; truncate?: boolean }[] = [
    { label: '文件名', value: fileName, truncate: true },
    { label: '目录', value: dirPath, truncate: true },
    { label: '格式', value: ext },
    { label: '类型', value: item.media_type === 'video' ? '视频' : '图片' },
    { label: '来源', value: SOURCE_LABELS[item.source_type] || item.source_type },
  ]

  if (item.width && item.height) {
    rows.push({ label: '分辨率', value: `${item.width} × ${item.height}` })
    rows.push({ label: '总像素', value: `${((item.width * item.height) / 1e6).toFixed(2)} MP` })
  }
  if (item.file_size) {
    rows.push({ label: '文件大小', value: formatFileSize(item.file_size) })
  }
  if (item.media_type === 'video' && videoDuration != null) {
    rows.push({ label: '时长', value: formatDuration(videoDuration) })
  }
  if (item.workflow_type) {
    rows.push({ label: '工作流', value: item.workflow_type })
  }
  if (item.rating) {
    rows.push({ label: '评分', value: '★'.repeat(item.rating) })
  }
  rows.push({ label: '创建时间', value: new Date(item.created_at).toLocaleString('zh-CN', { hour12: false }) })

  // Download-specific info
  if (downloadInfo) {
    rows.push({ label: '来源平台', value: PLATFORM_LABELS[downloadInfo.platform] || downloadInfo.platform })
    if (downloadInfo.title) {
      rows.push({ label: '原始标题', value: downloadInfo.title, truncate: true })
    }
    if (downloadInfo.display_name || downloadInfo.username) {
      rows.push({ label: '作者', value: downloadInfo.display_name || downloadInfo.username || '' })
    }
    if (downloadInfo.published_at) {
      rows.push({ label: '发布时间', value: new Date(downloadInfo.published_at).toLocaleString('zh-CN', { hour12: false }) })
    }
    rows.push({ label: '下载时间', value: new Date(downloadInfo.downloaded_at).toLocaleString('zh-CN', { hour12: false }) })
    rows.push({ label: '来源链接', value: downloadInfo.source_url, truncate: true })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>媒体详情</DialogTitle>
        </DialogHeader>
        {isMissing && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/5 px-3 py-2">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
            <span className="text-sm text-destructive">文件不存在，可能已被移动或删除</span>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto shrink-0 h-7 text-xs"
              onClick={handleRelocate}
              disabled={relocating}
            >
              <FileSearch className="w-3.5 h-3.5 mr-1" />
              {relocating ? '选择中...' : '重新定位'}
            </Button>
          </div>
        )}
        <div className="flex gap-4">
          <img
            src={mediaApi.itemThumbUrl(item, 200)}
            alt=""
            className="w-24 h-24 rounded object-cover shrink-0 bg-muted"
          />
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm min-w-0 flex-1">
            {rows.map((row) => (
              <Row key={row.label} label={row.label} value={row.value} truncate={row.truncate} />
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Row({ label, value, truncate }: { label: string; value: string; truncate?: boolean }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [value])

  return (
    <>
      <span className="text-muted-foreground whitespace-nowrap">{label}</span>
      {truncate ? (
        <span className="flex items-center gap-1 min-w-0">
          <span className="truncate select-text" title={value}>{value}</span>
          <button
            onClick={handleCopy}
            className="shrink-0 p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="复制"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </span>
      ) : (
        <span className="break-all select-text" title={value}>{value}</span>
      )}
    </>
  )
}

const SOURCE_LABELS: Record<string, string> = {
  local: '本地导入',
  generated: 'AI 生成',
  screenshot: '视频截图',
}

const PLATFORM_LABELS: Record<string, string> = {
  xiaohongshu: '小红书',
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  if (m === 0) return `${s} 秒`
  return `${m}:${s.toString().padStart(2, '0')}`
}
