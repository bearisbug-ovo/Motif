import React, { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { TaskItem } from '@/api/tasks'
import { mediaApi, MediaItem } from '@/api/media'
import { useMediaStore } from '@/stores/media'
import { cn } from '@/lib/utils'

const WORKFLOW_LABELS: Record<string, string> = {
  upscale: '高清放大',
  face_swap: '换脸',
  inpaint_flux: '局部修复 (Flux)',
  inpaint_sdxl: '局部修复 (SDXL)',
  inpaint_klein: '局部修复 (Klein)',
}

const STATUS_LABELS: Record<string, string> = {
  pending: '等待中',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'text-muted-foreground',
  running: 'text-blue-500',
  completed: 'text-green-500',
  failed: 'text-destructive',
  cancelled: 'text-muted-foreground',
}

// Param keys that are media IDs (show thumbnail)
const MEDIA_ID_KEYS = new Set([
  'source_media_id',
  'face_ref_media_id',
])

// Human-readable labels for known param keys
const PARAM_LABELS: Record<string, string> = {
  source_media_id: '源图片',
  face_ref_media_id: '人脸参考',
  target_person_id: '目标人物',
  result_album_id: '结果图集',
  upscale_factor: '放大倍数',
  denoise: '降噪强度',
  model: '模型',
  prompt: '提示词',
  seed: '随机种子',
  mask_path: '蒙版路径',
  enable_rear_lora: '启用解剖 LoRA',
  count: '数量',
  workflow_name: '工作流名称',
}

// Param keys to hide from display (internal use only)
const HIDDEN_PARAMS = new Set([
  'workflow_name',
  'workflow_id',
])

interface TaskDetailDialogProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  task: TaskItem | null
}

export function TaskDetailDialog({ open, onOpenChange, task }: TaskDetailDialogProps) {
  const [mediaMap, setMediaMap] = useState<Record<string, MediaItem>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !task) {
      setMediaMap({})
      return
    }
    // Collect all media IDs from params and result_media_ids
    const ids = new Set<string>()
    if (task.params) {
      for (const [key, val] of Object.entries(task.params)) {
        if (MEDIA_ID_KEYS.has(key) && typeof val === 'string') {
          ids.add(val)
        }
      }
    }
    for (const id of task.result_media_ids || []) {
      ids.add(id)
    }

    if (ids.size === 0) return

    setLoading(true)
    mediaApi.getByIds([...ids])
      .then(items => {
        const map: Record<string, MediaItem> = {}
        for (const item of items) map[item.id] = item
        setMediaMap(map)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [open, task])

  if (!task) return null

  const params = task.params || {}
  const resolved = task.resolved || {}
  const resultIds = task.result_media_ids || []
  const resultOutputs = task.result_outputs || {}

  const workflowLabel = (() => {
    if (task.workflow_type.startsWith('custom:')) {
      const category = resolved['workflow_category']
      const name = resolved['workflow_name']
      if (category && name) return `${category} · ${name}`
      if (name) return name
      return '自定义工作流'
    }
    return WORKFLOW_LABELS[task.workflow_type] || task.workflow_type
  })()

  // Build display params: exclude hidden keys, group media params first
  const mediaParams = Object.entries(params).filter(([k]) => MEDIA_ID_KEYS.has(k))
  const otherParams = Object.entries(params).filter(([k]) => !MEDIA_ID_KEYS.has(k) && !HIDDEN_PARAMS.has(k))
  // Filter out ID-only params that have resolved names (show resolved instead)
  const ID_ONLY_KEYS = new Set(['target_person_id', 'result_album_id'])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>任务详情</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {/* Basic info */}
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <span className="text-muted-foreground">类型</span>
            <span className="font-medium">{workflowLabel}</span>

            <span className="text-muted-foreground">状态</span>
            <span className={cn('font-medium', STATUS_COLORS[task.status])}>
              {STATUS_LABELS[task.status]}
            </span>

            <span className="text-muted-foreground">创建时间</span>
            <span>{formatTime(task.created_at)}</span>

            {task.started_at && (
              <>
                <span className="text-muted-foreground">开始时间</span>
                <span>{formatTime(task.started_at)}</span>
              </>
            )}

            {task.finished_at && (
              <>
                <span className="text-muted-foreground">完成时间</span>
                <span>{formatTime(task.finished_at)}</span>
              </>
            )}

            {task.started_at && task.finished_at && (
              <>
                <span className="text-muted-foreground">耗时</span>
                <span>{formatDuration(task.started_at, task.finished_at)}</span>
              </>
            )}
          </div>

          {/* Error message */}
          {task.error_message && (
            <div>
              <h3 className="text-xs font-semibold text-destructive mb-1">错误信息</h3>
              <pre className="text-xs bg-destructive/5 text-destructive p-2 rounded whitespace-pre-wrap break-all">
                {task.error_message}
              </pre>
            </div>
          )}

          {/* Media params (source/reference images) */}
          {mediaParams.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground mb-2">输入图片</h3>
              <div className="space-y-2">
                {mediaParams.map(([key, val]) => (
                  <div key={key}>
                    <div className="text-xs text-muted-foreground mb-1">{PARAM_LABELS[key] || key}</div>
                    {typeof val === 'string' && mediaMap[val] ? (
                      <MediaPreview media={mediaMap[val]} />
                    ) : (
                      <div className="text-xs text-muted-foreground italic">
                        {resolved[key] || '(未找到)'}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Other params */}
          {otherParams.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground mb-2">参数</h3>
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
                {otherParams.map(([key, val]) => {
                  const label = PARAM_LABELS[key] || key
                  let displayVal: string

                  if (ID_ONLY_KEYS.has(key) && resolved[key]) {
                    displayVal = resolved[key]
                  } else if (typeof val === 'boolean') {
                    displayVal = val ? '是' : '否'
                  } else if (key === 'seed' && (val === -1 || val === '-1')) {
                    displayVal = '随机'
                  } else if (typeof val === 'object') {
                    displayVal = JSON.stringify(val)
                  } else {
                    displayVal = String(val)
                  }

                  return (
                    <React.Fragment key={key}>
                      <span className="text-xs text-muted-foreground">{label}</span>
                      <span className="text-xs break-all">{displayVal}</span>
                    </React.Fragment>
                  )
                })}
              </div>
            </div>
          )}

          {/* Outputs (text + image) */}
          {Object.keys(resultOutputs).length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground mb-2">输出参数</h3>
              <div className="space-y-2">
                {Object.entries(resultOutputs).map(([key, val]) => (
                  <div key={key}>
                    <div className="text-xs text-muted-foreground">{key}</div>
                    {isImageOutput(val) ? (
                      <div className="grid grid-cols-3 gap-2 mt-1">
                        {getImagePaths(val).map((p, i) => (
                          <img
                            key={i}
                            src={`/api/files/serve?path=${encodeURIComponent(p)}`}
                            alt={`${key}-${i}`}
                            className="w-full rounded object-cover aspect-square bg-muted"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs font-mono bg-muted px-2 py-1 rounded break-all whitespace-pre-wrap">
                        {typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Result media */}
          {resultIds.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground mb-2">结果 ({resultIds.length})</h3>
              {loading ? (
                <div className="text-xs text-muted-foreground">加载中...</div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {resultIds.map((id, idx) => {
                    const m = mediaMap[id]
                    return m ? (
                      <div key={id} className="cursor-pointer" onClick={() => {
                        const items = resultIds.map(rid => mediaMap[rid]).filter(Boolean) as MediaItem[]
                        if (items.length > 0) {
                          onOpenChange(false)
                          useMediaStore.getState().openLightbox(items, idx)
                        }
                      }}>
                        <MediaPreview media={m} showPath />
                      </div>
                    ) : (
                      <div key={id} className="text-xs text-muted-foreground bg-muted p-2 rounded italic">图片已删除</div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function MediaPreview({ media, showPath }: { media: MediaItem; showPath?: boolean }) {
  return (
    <div className="flex items-start gap-2 bg-muted/50 rounded p-1.5">
      <img
        src={mediaApi.itemThumbUrl(media, 200)}
        alt=""
        className="w-16 h-16 rounded object-cover shrink-0"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
      />
      <div className="min-w-0 flex-1">
        <div className="text-xs truncate" title={media.file_path}>
          {shortenPath(media.file_path)}
        </div>
        {showPath && (
          <div className="text-xs text-muted-foreground truncate" title={media.file_path}>
            {media.file_path}
          </div>
        )}
        {media.width && media.height && (
          <div className="text-xs text-muted-foreground">{media.width}x{media.height}</div>
        )}
      </div>
    </div>
  )
}

function isImageOutput(val: any): boolean {
  return typeof val === 'object' && val !== null && val.type === 'image'
}

function getImagePaths(val: any): string[] {
  if (val.path) return [val.path]
  if (val.paths) return val.paths
  return []
}

function shortenPath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts.length > 2 ? `.../${parts.slice(-2).join('/')}` : path
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

function formatDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const remainSec = seconds % 60
  return `${minutes} 分 ${remainSec} 秒`
}
