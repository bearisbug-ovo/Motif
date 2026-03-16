import { useEffect, useState, useMemo, useCallback } from 'react'
import { Plus, Trash2, Loader2, GripVertical, Layers } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useWorkflowStore } from '@/stores/workflow'
import { workflowsApi, WorkflowListItem } from '@/api/workflows'
import { toast } from '@/hooks/use-toast'

interface CompositeWorkflowDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => void
  /** Pre-fill first step with this workflow */
  initialWorkflow?: WorkflowListItem | null
}

interface StepState {
  categoryKey: string
  workflowId: string
}

export function CompositeWorkflowDialog({ open, onOpenChange, onDone, initialWorkflow }: CompositeWorkflowDialogProps) {
  const { categories, fetchCategories } = useWorkflowStore()

  // Use local workflow list to avoid polluting the shared store's filtered state
  const [allWorkflows, setAllWorkflows] = useState<WorkflowListItem[]>([])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [steps, setSteps] = useState<StepState[]>([
    { categoryKey: '', workflowId: '' },
    { categoryKey: '', workflowId: '' },
  ])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    fetchCategories()
    // Fetch all workflows into local state (not the shared store)
    workflowsApi.list().then(setAllWorkflows).catch(() => {})
  }, [open, fetchCategories])

  useEffect(() => {
    if (!open) {
      setName('')
      setDescription('')
      setSteps([
        { categoryKey: '', workflowId: '' },
        { categoryKey: '', workflowId: '' },
      ])
      setSubmitting(false)
      return
    }
    // Pre-fill first step from initialWorkflow
    if (initialWorkflow) {
      setSteps([
        { categoryKey: initialWorkflow.category, workflowId: initialWorkflow.id },
        { categoryKey: '', workflowId: '' },
      ])
    }
  }, [open, initialWorkflow])

  const getWorkflowsForCategory = useCallback((catKey: string) => {
    return allWorkflows.filter(w => w.category === catKey)
  }, [allWorkflows])

  const handleStepCategoryChange = useCallback((idx: number, catKey: string) => {
    setSteps(prev => {
      const next = [...prev]
      const catWfs = allWorkflows.filter(w => w.category === catKey)
      const defWf = catWfs.find(w => w.is_default) || catWfs[0]
      next[idx] = { categoryKey: catKey, workflowId: defWf?.id || '' }
      return next
    })
  }, [allWorkflows])

  const handleStepWorkflowChange = useCallback((idx: number, wfId: string) => {
    setSteps(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], workflowId: wfId }
      return next
    })
  }, [])

  const handleAddStep = useCallback(() => {
    if (steps.length >= 5) return
    setSteps(prev => [...prev, { categoryKey: '', workflowId: '' }])
  }, [steps.length])

  const handleRemoveStep = useCallback((idx: number) => {
    if (steps.length <= 2) return
    setSteps(prev => prev.filter((_, i) => i !== idx))
  }, [steps.length])

  // Count expanded steps (composite steps expand recursively)
  const expandedCount = useMemo(() => {
    let count = 0
    for (const step of steps) {
      if (!step.workflowId) { count += 1; continue }
      const wf = allWorkflows.find(w => w.id === step.workflowId)
      if (wf?.is_composite && wf.composite_step_count) {
        count += wf.composite_step_count
      } else {
        count += 1
      }
    }
    return count
  }, [steps, allWorkflows])

  const canSubmit = useMemo(() => {
    if (!name.trim()) return false
    if (steps.length < 2) return false
    if (steps.some(s => !s.workflowId)) return false
    if (expandedCount > 10) return false
    return true
  }, [name, steps, expandedCount])

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await workflowsApi.createComposite({
        name: name.trim(),
        description: description.trim() || undefined,
        steps: steps.map(s => ({
          workflow_id: s.workflowId,
          params_override: {},
        })),
      })
      toast({ title: '复合工作流已创建' })
      onDone()
      onOpenChange(false)
    } catch (err: any) {
      toast({ title: '创建失败', description: err.response?.data?.detail || err.message, variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }, [canSubmit, name, description, steps, onDone, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col !gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-3 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Layers className="w-5 h-5" />
            创建复合工作流
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 space-y-4 min-h-0" onWheel={e => e.stopPropagation()}>
          <div className="space-y-1">
            <label className="text-sm font-medium">名称</label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="如：换脸+高清放大"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">描述</label>
            <Input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="可选"
            />
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium">步骤</label>
            {steps.map((step, idx) => {
              const catWfs = getWorkflowsForCategory(step.categoryKey)
              return (
                <div key={idx} className="flex items-start gap-2 p-3 rounded-lg border border-border bg-muted/30">
                  <div className="flex items-center gap-1 text-muted-foreground pt-1.5 shrink-0">
                    <GripVertical className="w-3.5 h-3.5" />
                    <span className="text-xs font-medium w-4">{idx + 1}</span>
                  </div>
                  <div className="flex-1 space-y-2 min-w-0">
                    <Select value={step.categoryKey} onValueChange={v => handleStepCategoryChange(idx, v)}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="选择类别..." />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map(c => (
                          <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {step.categoryKey && (
                      catWfs.length > 0 ? (
                        <Select value={step.workflowId} onValueChange={v => handleStepWorkflowChange(idx, v)}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="选择工作流..." />
                          </SelectTrigger>
                          <SelectContent>
                            {catWfs.map(wf => (
                              <SelectItem key={wf.id} value={wf.id}>
                                {wf.name}{wf.is_default ? ' (默认)' : ''}{wf.is_composite ? ' (复合)' : ''}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <p className="text-xs text-muted-foreground py-1">该类别暂无工作流</p>
                      )
                    )}
                  </div>
                  {steps.length > 2 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemoveStep(idx)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              )
            })}

            {steps.length < 5 && (
              <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={handleAddStep}>
                <Plus className="w-4 h-4" />
                添加步骤
              </Button>
            )}
          </div>

          <div className="text-xs text-muted-foreground">
            展开后共 {expandedCount} 步{expandedCount > 10 && <span className="text-destructive ml-1">(超过上限 10 步)</span>}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0 px-6 pb-6 pt-3 shrink-0 border-t border-border">
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSubmit} disabled={submitting || !canSubmit}>
            {submitting && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
