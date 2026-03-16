import { useState } from 'react'
import { RotateCcw, Trash2, Image, Info, Eye, XCircle, Link2, PenLine } from 'lucide-react'
import { TaskItem, TaskProgress } from '@/api/tasks'
import { Button } from '@/components/ui/button'
import { ContextMenuPortal, MenuItem, MenuSeparator } from '@/components/ContextMenuPortal'
import { cn } from '@/lib/utils'

const WORKFLOW_LABELS: Record<string, string> = {
  upscale: '高清放大',
  face_swap: '换脸',
  inpaint_flux: '局部修复 (Flux)',
  inpaint_sdxl: '局部修复 (SDXL)',
  inpaint_klein: '局部修复 (Klein)',
  image_to_image: '图生图',
  text_to_image: '文生图',
  preprocess: '预处理',
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground',
  running: 'bg-blue-500/10 text-blue-500',
  completed: 'bg-green-500/10 text-green-500',
  failed: 'bg-destructive/10 text-destructive',
  cancelled: 'bg-muted text-muted-foreground',
}

const STATUS_LABELS: Record<string, string> = {
  pending: '等待中',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

interface TaskCardProps {
  task: TaskItem
  progress?: TaskProgress | null
  onRetry: (id: string) => void
  onDelete: (id: string) => void
  onCancel?: (id: string) => void
  onViewDetail?: (task: TaskItem) => void
  onViewResults?: (task: TaskItem) => void
  onEditAndCreate?: (task: TaskItem) => void
}

function getWorkflowLabel(task: TaskItem): string {
  const resolved = task.resolved || {}
  if (task.workflow_type.startsWith('custom:')) {
    const category = resolved['workflow_category']
    const name = resolved['workflow_name']
    if (category && name) return `${category} · ${name}`
    if (name) return name
    return '自定义工作流'
  }
  return WORKFLOW_LABELS[task.workflow_type] || task.workflow_type
}

function getTaskSummary(task: TaskItem): string {
  const resolved = task.resolved || {}
  const parts: string[] = []

  // Source file name
  const sourceName = resolved['source_media_id']
  if (sourceName) parts.push(sourceName)

  // Target person
  const personName = resolved['target_person_id']
  if (personName) parts.push(personName)

  // Result album
  const albumName = resolved['result_album_id']
  if (albumName) parts.push(`→ ${albumName}`)

  return parts.join(' · ')
}

function getSourceThumbUrl(task: TaskItem): string | null {
  const resolved = task.resolved || {}
  // Find the first __path key (source image thumbnail)
  const path = Object.entries(resolved).find(([k]) => k.endsWith('__path'))?.[1]
  if (!path) return null
  return `/api/files/thumb?path=${encodeURIComponent(path)}&size=100`
}

function formatDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}秒`
  const minutes = Math.floor(seconds / 60)
  const remainSec = seconds % 60
  return remainSec > 0 ? `${minutes}分${remainSec}秒` : `${minutes}分`
}

function getTimeInfo(task: TaskItem): string {
  if (task.started_at && task.finished_at) {
    return `耗时 ${formatDuration(task.started_at, task.finished_at)}`
  }
  if (task.started_at) {
    return `开始于 ${new Date(task.started_at).toLocaleTimeString('zh-CN', { hour12: false })}`
  }
  return new Date(task.created_at).toLocaleString('zh-CN', { hour12: false })
}

export function TaskCard({ task, progress, onRetry, onDelete, onCancel, onViewDetail, onViewResults, onEditAndCreate }: TaskCardProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [thumbError, setThumbError] = useState(false)
  const resultCount = task.result_media_ids?.length || 0

  const taskProgress = progress?.task_id === task.id ? progress : null
  const summary = getTaskSummary(task)
  const thumbUrl = getSourceThumbUrl(task)

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  return (
    <>
      <div
        className="flex items-center gap-2 sm:gap-3 rounded-lg border border-border p-2 sm:p-3 bg-card"
        onContextMenu={handleContextMenu}
      >
        {/* Thumbnail */}
        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded bg-muted flex items-center justify-center shrink-0 overflow-hidden">
          {thumbUrl && !thumbError ? (
            <img
              src={thumbUrl}
              alt=""
              className="w-full h-full object-cover"
              onError={() => setThumbError(true)}
            />
          ) : (
            <Image className="w-5 h-5 text-muted-foreground" />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">
              {getWorkflowLabel(task)}
            </span>
            {task.chain_id && (
              <span className="inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full bg-primary/10 text-primary shrink-0">
                <Link2 className="w-3 h-3" />
                {(task.chain_order ?? 0) + 1}/{task.chain_tasks?.length ?? '?'}
              </span>
            )}
            <span className={cn('text-xs px-1.5 py-0.5 rounded-full shrink-0', STATUS_STYLES[task.status])}>
              {STATUS_LABELS[task.status]}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 truncate">
            {summary && <span>{summary} · </span>}
            {getTimeInfo(task)}
            {resultCount > 0 && ` · ${resultCount} 张结果`}
          </div>
          {task.chain_id && task.chain_tasks && task.chain_tasks.length > 1 && (
            <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1 truncate">
              {task.chain_tasks.map((ct, i) => {
                const label = ct.label || WORKFLOW_LABELS[ct.workflow_type] || ct.workflow_type
                const isCurrent = ct.id === task.id
                return (
                  <span key={ct.id} className="inline-flex items-center gap-0.5 shrink-0">
                    {i > 0 && <span className="text-muted-foreground/50 mx-0.5">→</span>}
                    <span className={cn(
                      'inline-flex items-center gap-0.5',
                      isCurrent ? 'text-foreground font-medium' : 'text-muted-foreground'
                    )}>
                      {`${i + 1}. ${label}`}
                    </span>
                  </span>
                )
              })}
            </div>
          )}
          {task.error_message && (
            <p className="text-xs text-destructive mt-1 truncate">{task.error_message}</p>
          )}

          {/* Progress bar for running tasks */}
          {task.status === 'running' && taskProgress && (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-300"
                  style={{ width: `${Math.round((taskProgress.value / taskProgress.max) * 100)}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {taskProgress.value}/{taskProgress.max}
              </span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-1 shrink-0">
          {(task.status === 'pending' || task.status === 'running') && onCancel && (
            <Button variant="ghost" size="sm" onClick={() => onCancel(task.id)} title="取消">
              <XCircle className="w-4 h-4" />
            </Button>
          )}
          {(task.status === 'failed' || task.status === 'cancelled') && (
            <Button variant="ghost" size="sm" onClick={() => onRetry(task.id)} title="重试">
              <RotateCcw className="w-4 h-4" />
            </Button>
          )}
          {task.status !== 'running' && (
            <Button variant="ghost" size="sm" onClick={() => onDelete(task.id)} title="删除">
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenuPortal position={contextMenu} onClose={() => setContextMenu(null)}>
          <MenuItem
            icon={<Info className="w-3.5 h-3.5" />}
            label="查看详情"
            onClick={() => { setContextMenu(null); onViewDetail?.(task) }}
          />
          {task.status !== 'running' && task.workflow_type.startsWith('custom:') && onEditAndCreate && (
            <MenuItem
              icon={<PenLine className="w-3.5 h-3.5" />}
              label="编辑参数并新建"
              onClick={() => { setContextMenu(null); onEditAndCreate(task) }}
            />
          )}
          {task.status === 'completed' && resultCount > 0 && (
            <MenuItem
              icon={<Eye className="w-3.5 h-3.5" />}
              label="查看结果"
              onClick={() => { setContextMenu(null); onViewResults?.(task) }}
            />
          )}
          {(task.status === 'pending' || task.status === 'running') && onCancel && (
            <MenuItem
              icon={<XCircle className="w-3.5 h-3.5" />}
              label="取消"
              onClick={() => { setContextMenu(null); onCancel(task.id) }}
            />
          )}
          {(task.status === 'failed' || task.status === 'cancelled') && (
            <MenuItem
              icon={<RotateCcw className="w-3.5 h-3.5" />}
              label="重试"
              onClick={() => { setContextMenu(null); onRetry(task.id) }}
            />
          )}
          {task.status === 'completed' && (
            <MenuItem
              icon={<RotateCcw className="w-3.5 h-3.5" />}
              label="重新执行"
              onClick={() => { setContextMenu(null); onRetry(task.id) }}
            />
          )}
          {task.status !== 'running' && (
            <>
              <MenuSeparator />
              <MenuItem
                icon={<Trash2 className="w-3.5 h-3.5" />}
                label="删除"
                onClick={() => { setContextMenu(null); onDelete(task.id) }}
                destructive
              />
            </>
          )}
        </ContextMenuPortal>
      )}
    </>
  )
}
