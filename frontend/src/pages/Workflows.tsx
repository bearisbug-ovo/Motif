import { useEffect, useState } from 'react'
import { Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkflowStore } from '@/stores/workflow'
import { cn } from '@/lib/utils'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { WorkflowManager } from '@/components/WorkflowManager'
import { WorkflowRunDialog } from '@/components/WorkflowRunDialog'

type Tab = 'run' | 'manage'

export function Workflows() {
  const [activeTab, setActiveTab] = useState<Tab>('run')

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border shrink-0">
        <div className="flex items-center gap-4 px-3 sm:px-4 h-12 sm:h-14 max-w-2xl mx-auto">
          <h1 className="text-base sm:text-lg font-semibold">工作流</h1>
          <div className="flex gap-1 bg-muted rounded-md p-0.5">
            <button
              className={cn(
                'px-3 py-1 text-sm rounded transition-colors',
                activeTab === 'run' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setActiveTab('run')}
            >
              运行
            </button>
            <button
              className={cn(
                'px-3 py-1 text-sm rounded transition-colors',
                activeTab === 'manage' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setActiveTab('manage')}
            >
              管理
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-28 md:pb-4">
        {activeTab === 'run' ? <RunTab /> : (
          <div className="max-w-2xl mx-auto p-4">
            <WorkflowManager />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Run Tab ───────────────────────────────────────────────────────────────────
// Thin selector → opens WorkflowRunDialog for full configuration & submission.

function RunTab() {
  const { categories, workflows, fetchCategories, fetchWorkflows } = useWorkflowStore()
  const [selectedId, setSelectedId] = useState<string>('')
  const [dialogOpen, setDialogOpen] = useState(false)

  useEffect(() => {
    fetchCategories()
    fetchWorkflows()
  }, [fetchCategories, fetchWorkflows])

  const grouped = workflows.reduce<Record<string, typeof workflows>>((acc, wf) => {
    (acc[wf.category] ||= []).push(wf)
    return acc
  }, {})

  const selectedWf = workflows.find(w => w.id === selectedId)
  const selectedCategory = selectedWf
    ? categories.find(c => c.key === selectedWf.category)?.key || ''
    : ''

  const handleRun = () => {
    if (!selectedWf) return
    setDialogOpen(true)
  }

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

      {selectedWf?.description && (
        <p className="text-sm text-muted-foreground">{selectedWf.description}</p>
      )}

      {selectedWf && (
        <Button className="w-full gap-1.5" onClick={handleRun}>
          <Play className="w-4 h-4" />
          配置并运行
        </Button>
      )}

      {!selectedId && (
        <div className="text-center py-12 text-muted-foreground text-sm">
          选择一个工作流开始使用
        </div>
      )}

      {/* Reuse WorkflowRunDialog for full configuration, composite steps, result destination, etc. */}
      <WorkflowRunDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        category={selectedCategory}
        sourceMedia={null}
        initialWorkflowId={selectedId}
      />
    </div>
  )
}
