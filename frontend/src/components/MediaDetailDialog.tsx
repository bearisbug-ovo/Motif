import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MediaItem, mediaApi } from '@/api/media'

interface MediaDetailDialogProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  item: MediaItem | null
}

export function MediaDetailDialog({ open, onOpenChange, item }: MediaDetailDialogProps) {
  const [videoDuration, setVideoDuration] = useState<number | null>(null)

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

  if (!item) return null

  const fileName = item.file_path.replace(/^.*[\\/]/, '')
  const dirPath = item.file_path.replace(/[\\/][^\\/]+$/, '')
  const ext = fileName.match(/\.([^.]+)$/)?.[1]?.toUpperCase() || ''

  const rows: [string, string][] = [
    ['文件名', fileName],
    ['目录', dirPath],
    ['格式', ext],
    ['类型', item.media_type === 'video' ? '视频' : '图片'],
    ['来源', SOURCE_LABELS[item.source_type] || item.source_type],
  ]

  if (item.width && item.height) {
    rows.push(['分辨率', `${item.width} × ${item.height}`])
    rows.push(['总像素', `${((item.width * item.height) / 1e6).toFixed(2)} MP`])
  }
  if (item.file_size) {
    rows.push(['文件大小', formatFileSize(item.file_size)])
  }
  if (item.media_type === 'video' && videoDuration != null) {
    rows.push(['时长', formatDuration(videoDuration)])
  }
  if (item.workflow_type) {
    rows.push(['工作流', item.workflow_type])
  }
  if (item.rating) {
    rows.push(['评分', '★'.repeat(item.rating)])
  }
  rows.push(['创建时间', new Date(item.created_at).toLocaleString('zh-CN', { hour12: false })])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>媒体详情</DialogTitle>
        </DialogHeader>
        <div className="flex gap-4">
          <img
            src={mediaApi.itemThumbUrl(item, 200)}
            alt=""
            className="w-24 h-24 rounded object-cover shrink-0 bg-muted"
          />
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm min-w-0 flex-1">
            {rows.map(([label, value]) => (
              <Row key={label} label={label} value={value} />
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-muted-foreground whitespace-nowrap">{label}</span>
      <span className="truncate" title={value}>{value}</span>
    </>
  )
}

const SOURCE_LABELS: Record<string, string> = {
  local: '本地导入',
  generated: 'AI 生成',
  screenshot: '视频截图',
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
