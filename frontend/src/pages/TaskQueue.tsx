import { useEffect, useState, useCallback, useMemo } from 'react'
import { Play, RefreshCw, Trash2, RotateCcw, Clock, CheckCircle2, XCircle, Loader2, GripVertical, ChevronDown, ChevronRight, FolderInput, FolderOpen, Briefcase, Star, Info } from 'lucide-react'
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTaskStore } from '@/stores/task'
import { useMediaStore } from '@/stores/media'
import { tasksApi, TaskItem, QueueConfig } from '@/api/tasks'
import { mediaApi, MediaItem } from '@/api/media'
import { TaskCard } from '@/components/TaskCard'
import { TaskDetailDialog } from '@/components/TaskDetailDialog'
import { LightBox } from '@/components/LightBox'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/components/Skeleton'
import { ContextMenuPortal, MenuItem, MenuSeparator } from '@/components/ContextMenuPortal'
import { AiMediaSubMenu } from '@/components/AiContextMenu'
import { MoveToAlbumDialog } from '@/components/MoveToAlbumDialog'
import { MediaDetailDialog } from '@/components/MediaDetailDialog'
import { useWorkspaceStore } from '@/stores/workspace'
import { ListTodo } from 'lucide-react'

const START_MODE_LABELS: Record<string, string> = {
  manual: '手动',
  auto: '自动',
  cron: '定时',
  delay: '延迟',
}

export function TaskQueue() {
  const { tasks, stats, progress, queueConfig, loading, fetchTasks, fetchStats, fetchQueueConfig } = useTaskStore()
  const { openLightbox } = useMediaStore()
  const [configForm, setConfigForm] = useState<Partial<QueueConfig>>({})
  const [configDirty, setConfigDirty] = useState(false)
  const [detailTask, setDetailTask] = useState<TaskItem | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [recentResultItems, setRecentResultItems] = useState<MediaItem[]>([])
  const [recentResultsExpanded, setRecentResultsExpanded] = useState(true)
  const [loadingResults, setLoadingResults] = useState(false)
  const [resultMenu, setResultMenu] = useState<{ x: number; y: number; item: MediaItem } | null>(null)
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveTarget, setMoveTarget] = useState<string[]>([])
  const [aiTarget, setAiTarget] = useState<{ category: string; media: MediaItem } | null>(null)
  const [detailItem, setDetailItem] = useState<MediaItem | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  )

  useEffect(() => {
    fetchTasks()
    fetchStats()
    fetchQueueConfig()
    tasksApi.resetStats()

    const id = setInterval(() => {
      fetchTasks()
      fetchStats()
    }, 3000)
    return () => clearInterval(id)
  }, [fetchTasks, fetchStats, fetchQueueConfig])

  useEffect(() => {
    if (queueConfig) {
      setConfigForm({
        start_mode: queueConfig.start_mode,
        delay_minutes: queueConfig.delay_minutes,
        is_paused: queueConfig.is_paused,
      })
    }
  }, [queueConfig])

  // Group tasks by status
  const running = tasks.filter(t => t.status === 'running')
  const pending = tasks.filter(t => t.status === 'pending')
  const completed = tasks.filter(t => t.status === 'completed')
  const failed = tasks.filter(t => t.status === 'failed')

  // Load recent result media when completed tasks change
  const recentResultIdsKey = useMemo(() => {
    const recent = [...completed]
      .sort((a, b) => (b.finished_at || b.created_at).localeCompare(a.finished_at || a.created_at))
      .slice(0, 10)
    const ids: string[] = []
    for (const t of recent) {
      for (const id of t.result_media_ids || []) {
        if (!ids.includes(id)) ids.push(id)
      }
    }
    return ids.join(',')
  }, [completed])

  const recentResultIds = useMemo(() => recentResultIdsKey ? recentResultIdsKey.split(',') : [], [recentResultIdsKey])

  useEffect(() => {
    if (recentResultIds.length === 0) {
      setRecentResultItems([])
      return
    }
    setLoadingResults(true)
    mediaApi.getByIds(recentResultIds)
      .then(setRecentResultItems)
      .catch(() => {})
      .finally(() => setLoadingResults(false))
  }, [recentResultIdsKey])

  const handleStartQueue = async () => {
    try {
      const res = await tasksApi.startQueue()
      toast({ title: `队列已启动，${res.pending} 个任务等待执行` })
      fetchTasks()
    } catch (err: any) {
      toast({ title: '启动失败', description: err.message, variant: 'destructive' })
    }
  }

  const handleSaveConfig = async () => {
    try {
      await tasksApi.updateQueueConfig(configForm)
      toast({ title: '队列配置已保存' })
      setConfigDirty(false)
      fetchQueueConfig()
    } catch (err: any) {
      toast({ title: '保存失败', description: err.message, variant: 'destructive' })
    }
  }

  const handleCancel = async (id: string) => {
    try {
      await tasksApi.cancel(id)
      toast({ title: '任务已取消' })
      fetchTasks()
    } catch (err: any) {
      toast({ title: '取消失败', description: err.message, variant: 'destructive' })
    }
  }

  const handleRetry = async (id: string) => {
    try {
      await tasksApi.retry(id)
      toast({ title: '任务已重新加入队列' })
      fetchTasks()
    } catch (err: any) {
      toast({ title: '重试失败', description: err.message, variant: 'destructive' })
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await tasksApi.delete(id)
      fetchTasks()
    } catch (err: any) {
      toast({ title: '删除失败', description: err.message, variant: 'destructive' })
    }
  }

  const handleViewDetail = (task: TaskItem) => {
    setDetailTask(task)
    setDetailOpen(true)
  }

  const handleViewResults = async (task: TaskItem) => {
    const ids = task.result_media_ids || []
    if (ids.length === 0) return
    // Try local cache first, otherwise fetch
    let items = ids.map(id => recentResultItems.find(m => m.id === id)).filter(Boolean) as MediaItem[]
    if (items.length === 0) {
      try {
        items = await mediaApi.getByIds(ids)
      } catch { return }
    }
    if (items.length > 0) {
      openLightbox(items, 0)
    }
  }

  const handleResultClick = (index: number) => {
    if (recentResultItems.length > 0) {
      openLightbox(recentResultItems, index)
    }
  }

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = pending.findIndex(t => t.id === active.id)
    const newIndex = pending.findIndex(t => t.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const reordered = arrayMove(pending, oldIndex, newIndex)
    try {
      await tasksApi.reorder(reordered.map(t => t.id))
      fetchTasks()
    } catch (err: any) {
      toast({ title: '排序失败', description: err.message, variant: 'destructive' })
    }
  }, [pending, fetchTasks])

  return (
    <div data-testid="task-queue-page" className="flex flex-col h-full">
      <div className="border-b border-border shrink-0">
        <div className="flex items-center justify-between px-6 h-14 max-w-2xl mx-auto">
          <h1 className="text-lg font-semibold">任务队列</h1>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => fetchTasks()}>
              <RefreshCw className="w-4 h-4 mr-1" />
              刷新
            </Button>
            <Button size="sm" onClick={handleStartQueue} disabled={!pending.length}>
              <Play className="w-4 h-4 mr-1" />
              开始执行
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-6 space-y-6 max-w-2xl mx-auto w-full">
        {/* Queue config card */}
        <section className="rounded-lg border border-border p-4">
          <h2 className="text-sm font-semibold mb-3">队列配置</h2>
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">启动模式</label>
              <div className="flex gap-1">
                {(['manual', 'auto', 'delay'] as const).map(mode => (
                  <Button
                    key={mode}
                    variant={configForm.start_mode === mode ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => { setConfigForm(f => ({ ...f, start_mode: mode })); setConfigDirty(true) }}
                  >
                    {START_MODE_LABELS[mode]}
                  </Button>
                ))}
              </div>
            </div>
            {configForm.start_mode === 'delay' && (
              <div>
                <label className="text-xs text-muted-foreground block mb-1">延迟 (分钟)</label>
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={configForm.delay_minutes || 5}
                  onChange={e => { setConfigForm(f => ({ ...f, delay_minutes: parseInt(e.target.value) || 5 })); setConfigDirty(true) }}
                  className="h-9 w-20 rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
            )}
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">暂停</label>
              <button
                onClick={() => { setConfigForm(f => ({ ...f, is_paused: !f.is_paused })); setConfigDirty(true) }}
                className={cn(
                  'w-10 h-5 rounded-full transition-colors relative',
                  configForm.is_paused ? 'bg-destructive' : 'bg-muted'
                )}
              >
                <span className={cn(
                  'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform',
                  configForm.is_paused ? 'left-5' : 'left-0.5'
                )} />
              </button>
            </div>
            {configDirty && (
              <Button size="sm" onClick={handleSaveConfig}>保存配置</Button>
            )}
          </div>
          {/* Stats */}
          {stats && (
            <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
              <span>等待中: {stats.pending}</span>
              <span>执行中: {stats.running}</span>
              <span>失败: {stats.failed}</span>
            </div>
          )}
        </section>

        {/* Running */}
        {running.length > 0 && (
          <TaskSection
            title="执行中"
            icon={<Loader2 className="w-4 h-4 animate-spin text-blue-500" />}
            tasks={running}
            progress={progress}
            onRetry={handleRetry}
            onDelete={handleDelete}
            onCancel={handleCancel}
            onViewDetail={handleViewDetail}
            onViewResults={handleViewResults}
          />
        )}

        {/* Pending — sortable */}
        {pending.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">等待中 ({pending.length})</h2>
              <span className="text-xs text-muted-foreground ml-1">拖拽排序</span>
            </div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={pending.map(t => t.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {pending.map(t => (
                    <SortableTaskCard
                      key={t.id}
                      task={t}
                      onRetry={handleRetry}
                      onDelete={handleDelete}
                      onCancel={handleCancel}
                      onViewDetail={handleViewDetail}
                      onViewResults={handleViewResults}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </section>
        )}

        {/* Failed */}
        {failed.length > 0 && (
          <TaskSection
            title="失败"
            icon={<XCircle className="w-4 h-4 text-destructive" />}
            tasks={failed}
            onRetry={handleRetry}
            onDelete={handleDelete}
            onViewDetail={handleViewDetail}
            onViewResults={handleViewResults}
          />
        )}

        {/* Recent completed results */}
        {recentResultItems.length > 0 && (
          <section>
            <button
              className="flex items-center gap-2 mb-3"
              onClick={() => setRecentResultsExpanded(v => !v)}
            >
              {recentResultsExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              <h2 className="text-sm font-semibold">最近结果 ({recentResultItems.length})</h2>
            </button>
            {recentResultsExpanded && (
              <div className="grid grid-cols-6 gap-2">
                {recentResultItems.map((item, i) => (
                  <button
                    key={item.id}
                    className="aspect-square rounded-lg overflow-hidden bg-muted hover:ring-2 hover:ring-primary transition-all"
                    onClick={() => handleResultClick(i)}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setResultMenu({ x: e.clientX, y: e.clientY, item }) }}
                  >
                    <img
                      src={mediaApi.itemThumbUrl(item, 200)}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Completed */}
        {completed.length > 0 && (
          <TaskSection
            title="已完成"
            icon={<CheckCircle2 className="w-4 h-4 text-green-500" />}
            tasks={completed}
            onRetry={handleRetry}
            onDelete={handleDelete}
            onViewDetail={handleViewDetail}
            onViewResults={handleViewResults}
          />
        )}

        {tasks.length === 0 && !loading && (
          <EmptyState icon={ListTodo} title="暂无任务" description="AI 操作产生的任务会出现在这里" />
        )}
      </div>

      {/* Task detail dialog */}
      <TaskDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        task={detailTask}
      />

      {/* Context menu for recent result items */}
      {resultMenu && (
        <ContextMenuPortal position={resultMenu} onClose={() => setResultMenu(null)}>
          <AiMediaSubMenu item={resultMenu.item} onAction={(cat) => { setAiTarget({ category: cat, media: resultMenu.item }); setResultMenu(null) }} />
          <MenuItem icon={<Briefcase className="w-3.5 h-3.5" />} label="加入工作区" onClick={async () => {
            try { await useWorkspaceStore.getState().addItem(resultMenu.item.id); toast({ title: '已加入工作区' }) }
            catch (err: any) { toast({ title: err.message || '添加失败', variant: 'destructive' }) }
            setResultMenu(null)
          }} />
          <MenuItem icon={<FolderInput className="w-3.5 h-3.5" />} label="移动到图集" onClick={() => { setMoveTarget([resultMenu.item.id]); setMoveOpen(true); setResultMenu(null) }} />
          <MenuItem icon={<FolderOpen className="w-3.5 h-3.5" />} label="在资源管理器中显示" onClick={() => { mediaApi.showInExplorer(resultMenu.item.id); setResultMenu(null) }} />
          <div className="px-3 py-1.5 flex items-center gap-1">
            <Star className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-muted-foreground text-xs mr-1">评分</span>
            {[1, 2, 3, 4, 5].map((r) => (
              <button key={r} className={cn('w-5 h-5 rounded text-xs font-medium transition-colors', resultMenu.item.rating === r ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}
                onClick={async () => { await useMediaStore.getState().updateMedia(resultMenu.item.id, { rating: r }); setResultMenu(null) }}>{r}</button>
            ))}
          </div>
          <MenuSeparator />
          <MenuItem icon={<Info className="w-3.5 h-3.5" />} label="查看详情" onClick={() => { setDetailItem(resultMenu.item); setResultMenu(null) }} />
          <MenuItem icon={<Trash2 className="w-3.5 h-3.5" />} label="删除" destructive onClick={async () => {
            setResultMenu(null)
            if (confirm('确定要删除这张图片吗？')) {
              await useMediaStore.getState().softDelete(resultMenu.item.id)
              setRecentResultItems(prev => prev.filter(m => m.id !== resultMenu.item.id))
            }
          }} />
        </ContextMenuPortal>
      )}

      <MoveToAlbumDialog open={moveOpen} onOpenChange={setMoveOpen} mediaIds={moveTarget} />
      <MediaDetailDialog open={!!detailItem} onOpenChange={(o) => { if (!o) setDetailItem(null) }} item={detailItem} />

      {/* LightBox for viewing result images */}
      <LightBox onAiAction={(cat, m) => setAiTarget({ category: cat, media: m })} />
    </div>
  )
}

function SortableTaskCard({ task, onRetry, onDelete, onCancel, onViewDetail, onViewResults }: {
  task: TaskItem
  onRetry: (id: string) => void
  onDelete: (id: string) => void
  onCancel?: (id: string) => void
  onViewDetail?: (task: TaskItem) => void
  onViewResults?: (task: TaskItem) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-1">
      <button {...attributes} {...listeners} className="p-1 cursor-grab text-muted-foreground hover:text-foreground touch-none">
        <GripVertical className="w-4 h-4" />
      </button>
      <div className="flex-1">
        <TaskCard
          task={task}
          onRetry={onRetry}
          onDelete={onDelete}
          onCancel={onCancel}
          onViewDetail={onViewDetail}
          onViewResults={onViewResults}
        />
      </div>
    </div>
  )
}

function TaskSection({ title, icon, tasks, progress, onRetry, onDelete, onCancel, onViewDetail, onViewResults }: {
  title: string
  icon: React.ReactNode
  tasks: TaskItem[]
  progress?: { task_id: string; value: number; max: number } | null
  onRetry: (id: string) => void
  onDelete: (id: string) => void
  onCancel?: (id: string) => void
  onViewDetail?: (task: TaskItem) => void
  onViewResults?: (task: TaskItem) => void
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h2 className="text-sm font-semibold">{title} ({tasks.length})</h2>
      </div>
      <div className="space-y-2">
        {tasks.map(t => (
          <TaskCard
            key={t.id}
            task={t}
            progress={progress}
            onRetry={onRetry}
            onDelete={onDelete}
            onCancel={onCancel}
            onViewDetail={onViewDetail}
            onViewResults={onViewResults}
          />
        ))}
      </div>
    </section>
  )
}
