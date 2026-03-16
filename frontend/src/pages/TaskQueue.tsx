import { useEffect, useState, useCallback, useMemo } from 'react'
import { Play, Pause, RefreshCw, Trash2, RotateCcw, Clock, CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp, ChevronRight, FolderInput, FolderOpen, Briefcase, Star, Info, Link2, Layers } from 'lucide-react'
import { useTaskStore } from '@/stores/task'
import { useMediaStore } from '@/stores/media'
import { tasksApi, TaskItem, QueueConfig } from '@/api/tasks'
import { mediaApi, MediaItem } from '@/api/media'
import { TaskCard } from '@/components/TaskCard'
import { TaskDetailDialog } from '@/components/TaskDetailDialog'
import { LightBox } from '@/components/LightBox'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { confirm } from '@/components/ConfirmDialog'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/components/Skeleton'
import { ContextMenuPortal, MenuItem, MenuSeparator } from '@/components/ContextMenuPortal'
import { AiMediaSubMenu } from '@/components/AiContextMenu'
import { MoveToAlbumDialog } from '@/components/MoveToAlbumDialog'
import { MediaDetailDialog } from '@/components/MediaDetailDialog'
import { WorkflowRunDialog } from '@/components/WorkflowRunDialog'
import { workflowsApi } from '@/api/workflows'
import { useWorkspaceStore } from '@/stores/workspace'
import { ListTodo } from 'lucide-react'

const START_MODE_LABELS: Record<string, string> = {
  manual: '手动',
  auto: '自动',
  cron: '定时',
  delay: '延迟',
}

/** Group tasks by batch_id. Tasks without batch_id are standalone. */
interface TaskGroup {
  type: 'single' | 'batch'
  tasks: TaskItem[]
  batchId?: string
  /** Display label for batch group */
  label?: string
}

function groupTasksByBatch(tasks: TaskItem[]): TaskGroup[] {
  const groups: TaskGroup[] = []
  const batchMap = new Map<string, TaskItem[]>()
  const standalone: TaskItem[] = []

  for (const t of tasks) {
    if (t.batch_id) {
      const list = batchMap.get(t.batch_id) || []
      list.push(t)
      batchMap.set(t.batch_id, list)
    } else {
      standalone.push(t)
    }
  }

  // Interleave batch groups and standalone tasks in original order
  // Use the first task's position in the original array as the group's position
  const items: { sortKey: number; group: TaskGroup }[] = []

  for (const [batchId, batchTasks] of batchMap.entries()) {
    const firstIdx = tasks.indexOf(batchTasks[0])
    const label = batchTasks[0].resolved?.['workflow_name'] || batchTasks[0].workflow_type
    items.push({
      sortKey: firstIdx,
      group: { type: 'batch', tasks: batchTasks, batchId, label },
    })
  }
  for (const t of standalone) {
    const idx = tasks.indexOf(t)
    items.push({
      sortKey: idx,
      group: { type: 'single', tasks: [t] },
    })
  }

  items.sort((a, b) => a.sortKey - b.sortKey)
  return items.map(i => i.group)
}

export function TaskQueue() {
  const { tasks, stats, progress, queueConfig, loading, fetchTasks, fetchStats, fetchQueueConfig } = useTaskStore()
  const { openLightbox } = useMediaStore()
  const [configForm, setConfigForm] = useState<Partial<QueueConfig>>({})
  const [configDirty, setConfigDirty] = useState(false)
  const [detailTask, setDetailTask] = useState<TaskItem | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [recentResultItems, setRecentResultItems] = useState<MediaItem[]>([])
  const [recentResultsExpanded, setRecentResultsExpanded] = useState(false)
  const [loadingResults, setLoadingResults] = useState(false)
  const [resultMenu, setResultMenu] = useState<{ x: number; y: number; item: MediaItem } | null>(null)
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveTarget, setMoveTarget] = useState<string[]>([])
  const [aiTarget, setAiTarget] = useState<{ category: string; media: MediaItem } | null>(null)
  const [detailItem, setDetailItem] = useState<MediaItem | null>(null)
  const [editTarget, setEditTarget] = useState<{
    category: string
    sourceMedia: MediaItem | null
    workflowId: string
    params: Record<string, any>
  } | null>(null)
  const [runningCollapsed, setRunningCollapsed] = useState(false)
  const [togglingPause, setTogglingPause] = useState(false)
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set())

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
    .sort((a, b) => (b.finished_at || b.created_at).localeCompare(a.finished_at || a.created_at))
  const failed = tasks.filter(t => t.status === 'failed')
    .sort((a, b) => (b.finished_at || b.created_at).localeCompare(a.finished_at || a.created_at))

  // Group pending tasks by batch
  const pendingGroups = useMemo(() => groupTasksByBatch(pending), [pending])

  // Load recent result media when completed tasks change
  const recentResultIdsKey = useMemo(() => {
    const recent = [...completed]
      .sort((a, b) => (b.finished_at || b.created_at).localeCompare(a.finished_at || a.created_at))
      .slice(0, 50)
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
      .then(items => {
        // Preserve the order from recentResultIds (sorted by task finished_at)
        const byId = new Map(items.map(m => [m.id, m]))
        setRecentResultItems(recentResultIds.map(id => byId.get(id)).filter(Boolean) as typeof items)
      })
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

  const handleTogglePause = async () => {
    setTogglingPause(true)
    try {
      const newPaused = !queueConfig?.is_paused
      await tasksApi.updateQueueConfig({ is_paused: newPaused })
      toast({ title: newPaused ? '队列已暂停' : '队列已恢复' })
      fetchQueueConfig()
    } catch (err: any) {
      toast({ title: '操作失败', description: err.message, variant: 'destructive' })
    } finally {
      setTogglingPause(false)
    }
  }

  const handleBulkDelete = async () => {
    const statuses = ['pending', 'failed', 'cancelled']
    const count = pending.length + failed.length
    if (count === 0) return
    if (!await confirm({ title: `确定删除全部未完成任务？`, description: `将删除 ${pending.length} 个等待中和 ${failed.length} 个失败的任务` })) return
    try {
      const res = await tasksApi.bulkDelete(statuses)
      toast({ title: `已删除 ${res.deleted} 个任务` })
      fetchTasks()
      fetchStats()
    } catch (err: any) {
      toast({ title: '删除失败', description: err.message, variant: 'destructive' })
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
      openLightbox(items, 0, { taskResultsMode: true })
    }
  }

  const handleEditAndCreate = async (task: TaskItem) => {
    if (!task.workflow_type.startsWith('custom:')) return
    const wfId = task.workflow_type.slice('custom:'.length)
    try {
      const wf = await workflowsApi.get(wfId)
      // Resolve source media from params (first image-type media ID)
      let sourceMedia: MediaItem | null = null
      const imageParamKeys = ['source_media_id', 'source_image', 'base_image']
      // Also check manifest for image params
      if (wf.manifest?.mappings) {
        for (const [name, mapping] of Object.entries(wf.manifest.mappings)) {
          if (mapping.type === 'image' && mapping.source !== 'file_path') {
            imageParamKeys.push(name)
          }
        }
      }
      for (const key of imageParamKeys) {
        const mid = task.params[key]
        if (mid && typeof mid === 'string' && mid.length > 8 && mid !== '__chain_input__') {
          try {
            const items = await mediaApi.getByIds([mid])
            if (items.length > 0) { sourceMedia = items[0]; break }
          } catch {}
        }
      }
      setEditTarget({
        category: wf.category,
        sourceMedia,
        workflowId: wfId,
        params: task.params,
      })
    } catch (err: any) {
      toast({ title: '无法加载工作流', description: err.message, variant: 'destructive' })
    }
  }

  const handleResultClick = (index: number) => {
    if (recentResultItems.length > 0) {
      openLightbox(recentResultItems, index, { taskResultsMode: true })
    }
  }

  const toggleBatch = useCallback((batchId: string) => {
    setExpandedBatches(prev => {
      const next = new Set(prev)
      if (next.has(batchId)) next.delete(batchId)
      else next.add(batchId)
      return next
    })
  }, [])

  return (
    <div data-testid="task-queue-page" className="flex flex-col h-full">
      <div className="border-b border-border shrink-0">
        <div className="flex items-center justify-between px-3 sm:px-6 h-12 sm:h-14">
          <h1 className="text-base sm:text-lg font-semibold shrink-0">任务队列</h1>
          <div className="flex items-center gap-1 sm:gap-2">
            {(pending.length > 0 || failed.length > 0) && (
              <Button variant="outline" size="sm" onClick={handleBulkDelete} className="h-8 w-8 p-0 sm:w-auto sm:px-3 text-destructive hover:text-destructive" title="清空未完成">
                <Trash2 className="w-4 h-4 sm:mr-1.5" />
                <span className="hidden sm:inline">清空未完成</span>
              </Button>
            )}
            <Button
              variant={queueConfig?.is_paused ? 'default' : 'outline'}
              size="sm"
              onClick={handleTogglePause}
              disabled={togglingPause}
              className={cn('h-8 w-8 p-0 sm:w-auto sm:px-3', queueConfig?.is_paused ? 'bg-amber-500 hover:bg-amber-600 text-white' : '')}
              title={queueConfig?.is_paused ? '恢复队列' : '暂停'}
            >
              {queueConfig?.is_paused ? <Play className="w-4 h-4 sm:mr-1.5" /> : <Pause className="w-4 h-4 sm:mr-1.5" />}
              <span className="hidden sm:inline">{queueConfig?.is_paused ? '恢复' : '暂停'}</span>
            </Button>
            <Button variant="outline" size="sm" onClick={() => fetchTasks()} className="h-8 w-8 p-0 sm:w-auto sm:px-3" title="刷新">
              <RefreshCw className="w-4 h-4 sm:mr-1.5" />
              <span className="hidden sm:inline">刷新</span>
            </Button>
            <Button size="sm" onClick={handleStartQueue} disabled={!pending.length} className="h-8 w-8 p-0 sm:w-auto sm:px-3" title="开始执行">
              <Play className="w-4 h-4 sm:mr-1.5" />
              <span className="hidden sm:inline">开始执行</span>
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-2 sm:px-6 py-2 sm:py-6 pb-28 md:pb-4">
        <div className="flex gap-6 max-w-5xl mx-auto w-full">
          {/* Left column: task lists */}
          <div className="flex-1 min-w-0 space-y-4 sm:space-y-6 max-w-2xl">
            {/* Queue config card */}
            <section className="rounded-lg border border-border p-3 sm:p-4">
              <h2 className="text-sm font-semibold mb-2 sm:mb-3">队列配置</h2>
              <div className="flex flex-wrap gap-3 sm:gap-4 items-end">
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

            {/* Running — sticky, collapsible when many tasks */}
            {running.length > 0 && (
              <div className="sticky top-0 z-10 bg-background -mx-2 px-2 sm:-mx-6 sm:px-6 -mt-2 pt-2 sm:-mt-6 sm:pt-6 pb-2 border-b border-border">
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                    <h2 className="text-sm font-semibold">执行中 ({running.length})</h2>
                    {running.length > 2 && (
                      <button
                        className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5"
                        onClick={() => setRunningCollapsed(v => !v)}
                      >
                        {runningCollapsed ? <><ChevronDown className="w-3.5 h-3.5" />展开</> : <><ChevronUp className="w-3.5 h-3.5" />收起</>}
                      </button>
                    )}
                  </div>
                  <div className="space-y-2">
                    {(runningCollapsed ? running.slice(0, 1) : running).map(t => (
                      <TaskCard
                        key={t.id}
                        task={t}
                        progress={progress}
                        onRetry={handleRetry}
                        onDelete={handleDelete}
                        onCancel={handleCancel}
                        onViewDetail={handleViewDetail}
                        onViewResults={handleViewResults}
                        onEditAndCreate={handleEditAndCreate}
                      />
                    ))}
                    {runningCollapsed && running.length > 1 && (
                      <div className="text-xs text-muted-foreground text-center py-1">
                        还有 {running.length - 1} 个任务执行中
                      </div>
                    )}
                  </div>
                </section>
              </div>
            )}

            {/* Pending — with batch grouping */}
            {pending.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">等待中 ({pending.length})</h2>
                </div>
                <div className="space-y-2">
                  {pendingGroups.map((group) => {
                    if (group.type === 'single') {
                      const t = group.tasks[0]
                      const isChainFollower = t.chain_id && (t.chain_order ?? 0) > 0
                      return (
                        <div key={t.id} className={cn(isChainFollower && 'ml-5 border-l-2 border-primary/30 pl-2')}>
                          <TaskCard
                            task={t}
                            onRetry={handleRetry}
                            onDelete={handleDelete}
                            onCancel={handleCancel}
                            onViewDetail={handleViewDetail}
                            onViewResults={handleViewResults}
                            onEditAndCreate={handleEditAndCreate}
                          />
                        </div>
                      )
                    }

                    // Batch group — collapsible
                    const batchId = group.batchId!
                    const isExpanded = expandedBatches.has(batchId)
                    const completedCount = group.tasks.filter(t => t.status === 'completed').length
                    const failedCount = group.tasks.filter(t => t.status === 'failed').length

                    return (
                      <div key={batchId} className="rounded-lg border border-border overflow-hidden">
                        {/* Batch header */}
                        <button
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-accent/50 transition-colors"
                          onClick={() => toggleBatch(batchId)}
                        >
                          <Layers className="w-4 h-4 text-primary shrink-0" />
                          <span className="flex-1 text-left truncate font-medium">
                            批量 · {group.label}
                          </span>
                          <span className="text-xs text-muted-foreground shrink-0">{group.tasks.length} 个任务</span>
                          {isExpanded
                            ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          }
                        </button>

                        {/* Expanded task list */}
                        {isExpanded && (
                          <div className="border-t border-border px-2 py-2 space-y-1.5">
                            {group.tasks.map(t => (
                              <TaskCard
                                key={t.id}
                                task={t}
                                onRetry={handleRetry}
                                onDelete={handleDelete}
                                onCancel={handleCancel}
                                onViewDetail={handleViewDetail}
                                onViewResults={handleViewResults}
                                onEditAndCreate={handleEditAndCreate}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
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
                onEditAndCreate={handleEditAndCreate}
              />
            )}

            {/* Mobile: Recent results inline */}
            {recentResultItems.length > 0 && (
              <section className="md:hidden">
                <RecentResultsGrid
                  items={recentResultItems}
                  expanded={recentResultsExpanded}
                  onToggle={() => setRecentResultsExpanded(v => !v)}
                  onClickItem={handleResultClick}
                  onContextMenu={(e, item) => { e.preventDefault(); e.stopPropagation(); setResultMenu({ x: e.clientX, y: e.clientY, item }) }}
                  cols={3}
                  collapsedRows={2}
                />
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
                onEditAndCreate={handleEditAndCreate}
              />
            )}

            {tasks.length === 0 && !loading && (
              <EmptyState icon={ListTodo} title="暂无任务" description="AI 操作产生的任务会出现在这里" />
            )}
          </div>

          {/* Right column: recent results (desktop only) */}
          {recentResultItems.length > 0 && (
            <div className="hidden md:block w-64 shrink-0">
              <div className="sticky top-6 max-h-[calc(100vh-6rem)] overflow-y-auto scrollbar-thin">
                <RecentResultsGrid
                  items={recentResultItems}
                  expanded={recentResultsExpanded}
                  onToggle={() => setRecentResultsExpanded(v => !v)}
                  onClickItem={handleResultClick}
                  onContextMenu={(e, item) => { e.preventDefault(); e.stopPropagation(); setResultMenu({ x: e.clientX, y: e.clientY, item }) }}
                  cols={3}
                  collapsedRows={6}
                />
              </div>
            </div>
          )}
        </div>
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
            if (await confirm({ title: '确定要删除这张图片吗？' })) {
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
      <WorkflowRunDialog
        open={!!aiTarget}
        onOpenChange={(v) => { if (!v) setAiTarget(null) }}
        category={aiTarget?.category || ''}
        sourceMedia={aiTarget?.media || null}
      />
      <WorkflowRunDialog
        open={!!editTarget}
        onOpenChange={(v) => { if (!v) setEditTarget(null) }}
        category={editTarget?.category || ''}
        sourceMedia={editTarget?.sourceMedia || null}
        initialWorkflowId={editTarget?.workflowId}
        initialParams={editTarget?.params}
      />
    </div>
  )
}

function RecentResultsGrid({ items, expanded, onToggle, onClickItem, onContextMenu, cols, collapsedRows }: {
  items: MediaItem[]
  expanded: boolean
  onToggle: () => void
  onClickItem: (index: number) => void
  onContextMenu: (e: React.MouseEvent, item: MediaItem) => void
  cols: number
  collapsedRows: number
}) {
  const collapsedCount = cols * collapsedRows
  const hasMore = items.length > collapsedCount
  const displayItems = expanded ? items : items.slice(0, collapsedCount)

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <CheckCircle2 className="w-4 h-4 text-green-500" />
        <h2 className="text-sm font-semibold">最近结果</h2>
        <span className="text-xs text-muted-foreground">({items.length})</span>
      </div>
      <div className={cn('grid gap-1.5', cols === 3 ? 'grid-cols-3' : 'grid-cols-4')}>
        {displayItems.map((item, i) => (
          <button
            key={item.id}
            className="aspect-square rounded-lg overflow-hidden bg-muted hover:ring-2 hover:ring-primary transition-all"
            onClick={() => onClickItem(i)}
            onContextMenu={(e) => onContextMenu(e, item)}
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
      {hasMore && (
        <button
          className="mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 w-full justify-center py-1"
          onClick={onToggle}
        >
          {expanded ? (
            <><ChevronDown className="w-3.5 h-3.5" />收起</>
          ) : (
            <><ChevronRight className="w-3.5 h-3.5" />展开全部 ({items.length})</>
          )}
        </button>
      )}
    </section>
  )
}

function TaskSection({ title, icon, tasks, progress, onRetry, onDelete, onCancel, onViewDetail, onViewResults, onEditAndCreate }: {
  title: string
  icon: React.ReactNode
  tasks: TaskItem[]
  progress?: { task_id: string; value: number; max: number } | null
  onRetry: (id: string) => void
  onDelete: (id: string) => void
  onCancel?: (id: string) => void
  onViewDetail?: (task: TaskItem) => void
  onViewResults?: (task: TaskItem) => void
  onEditAndCreate?: (task: TaskItem) => void
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
            onEditAndCreate={onEditAndCreate}
          />
        ))}
      </div>
    </section>
  )
}
