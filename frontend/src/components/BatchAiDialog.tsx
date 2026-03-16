import { useEffect, useState, useMemo, useCallback } from 'react'
import { Loader2, Sparkles, Layers, ChevronDown, ChevronUp, Link2, ClipboardList } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useWorkflowStore } from '@/stores/workflow'
import { workflowsApi, WorkflowFull } from '@/api/workflows'
import { tasksApi } from '@/api/tasks'
import { mediaApi } from '@/api/media'
import { FaceRefPicker } from './FaceRefPicker'
import { WorkflowParamForm, SOURCE_IMAGE_NAMES, isMaskParam } from './WorkflowParamForm'
import { ResultDestination } from './ResultDestination'
import { toast } from '@/hooks/use-toast'

interface BatchAiDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mediaIds?: string[]            // multi-select mode
  albumId?: string               // album mode
  albumName?: string             // display name for summary text
  personId?: string              // target person
  defaultCategory?: string       // pre-selected category
  imageCount?: number            // display count (album mode)
  onComplete?: () => void
}

/** Batchable categories — has source_image/base_image and no required file_path mask */
const BATCHABLE_CATEGORIES = ['upscale', 'face_swap', 'image_to_image', 'preprocess']

export function BatchAiDialog({
  open, onOpenChange, mediaIds, albumId, albumName, personId,
  defaultCategory, imageCount, onComplete,
}: BatchAiDialogProps) {
  const { categories, workflows, fetchCategories, fetchWorkflows } = useWorkflowStore()

  const [category, setCategory] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [workflowDetail, setWorkflowDetail] = useState<WorkflowFull | null>(null)
  const [firstStepDetail, setFirstStepDetail] = useState<WorkflowFull | null>(null)
  const [params, setParams] = useState<Record<string, any>>({})
  const [mediaThumbs, setMediaThumbs] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [pickerParam, setPickerParam] = useState<string | null>(null)

  // Result destination
  const [resultPersonId, setResultPersonId] = useState<string | null>(null)
  const [resultAlbumId, setResultAlbumId] = useState<string | null>(null)
  const [linkParent, setLinkParent] = useState(true)

  // Composite step details
  const [stepDetails, setStepDetails] = useState<(WorkflowFull | null)[]>([])
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set([0]))

  // Batchable categories with available workflows
  const batchableCategories = useMemo(() =>
    categories.filter(c => BATCHABLE_CATEGORIES.includes(c.key)),
    [categories]
  )

  const cat = useMemo(() => categories.find(c => c.key === category), [categories, category])
  const catWorkflows = useMemo(() => workflows.filter(w => w.category === category), [workflows, category])

  // Determine source param name for current category
  const sourceParamName = useMemo(() => {
    if (!cat) return 'source_image'
    const sourceParam = cat.params.find(p => p.type === 'image' && SOURCE_IMAGE_NAMES.includes(p.name))
    return sourceParam?.name || 'source_image'
  }, [cat])

  // Filter category params — hide source image and mask params
  // In batch mode, the source image param (base_image/source_image) is auto-filled per item
  const visibleParams = useMemo(() => {
    if (!cat) return []
    return cat.params.filter(p => {
      if (p.type === 'image' && SOURCE_IMAGE_NAMES.includes(p.name)) return false
      if (isMaskParam(p)) return false
      return true
    })
  }, [cat])

  const totalImages = imageCount ?? mediaIds?.length ?? 0

  // Load categories & workflows on open
  useEffect(() => {
    if (!open) return
    fetchCategories()
    fetchWorkflows()
  }, [open, fetchCategories, fetchWorkflows])

  // Set default category
  useEffect(() => {
    if (!open) return
    if (defaultCategory && BATCHABLE_CATEGORIES.includes(defaultCategory)) {
      setCategory(defaultCategory)
    }
  }, [open, defaultCategory])

  // Auto-select default workflow when category changes
  useEffect(() => {
    if (!open || !catWorkflows.length) return
    const def = catWorkflows.find(w => w.is_default) || catWorkflows[0]
    if (def && selectedId !== def.id) {
      setSelectedId(def.id)
    }
  }, [open, catWorkflows]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setCategory('')
      setSelectedId('')
      setWorkflowDetail(null)
      setFirstStepDetail(null)
      setParams({})
      setMediaThumbs({})
      setSubmitting(false)
      setPickerParam(null)
      setResultPersonId(null)
      setResultAlbumId(null)
      setLinkParent(true)
      setStepDetails([])
      setExpandedSteps(new Set([0]))
    }
  }, [open])

  // Load workflow detail when selection changes
  useEffect(() => {
    if (!selectedId) { setWorkflowDetail(null); setParams({}); return }
    workflowsApi.get(selectedId).then(async wf => {
      setWorkflowDetail(wf)
      const defaults: Record<string, any> = {}

      // For composite workflows, load first step's sub-workflow for defaults
      let effectiveWf = wf
      if (wf.is_composite && wf.composite_steps?.length) {
        try {
          effectiveWf = await workflowsApi.get(wf.composite_steps[0].workflow_id)
          setFirstStepDetail(effectiveWf)
        } catch { setFirstStepDetail(null) }
      } else {
        setFirstStepDetail(null)
      }

      if (effectiveWf.manifest?.mappings) {
        for (const [paramName, mapping] of Object.entries(effectiveWf.manifest.mappings)) {
          if (mapping.type === 'image') continue
          const nodeData = effectiveWf.workflow_json?.[mapping.node_id]
          if (nodeData?.inputs?.[mapping.key] !== undefined) {
            const val = nodeData.inputs[mapping.key]
            if (!Array.isArray(val)) defaults[paramName] = val
          }
        }
      }

      if (effectiveWf.manifest?.extra_params) {
        for (const ep of effectiveWf.manifest.extra_params) {
          if (ep.type === 'image') continue
          const nodeData = effectiveWf.workflow_json?.[ep.node_id]
          if (nodeData?.inputs?.[ep.key] !== undefined) {
            const val = nodeData.inputs[ep.key]
            if (!Array.isArray(val)) defaults[ep.name] = val
          }
        }
      }

      setParams(defaults)
      setMediaThumbs({})

      // Load composite step details
      if (wf.is_composite && wf.composite_steps?.length) {
        const details: (WorkflowFull | null)[] = []
        for (const step of wf.composite_steps) {
          try {
            details.push(await workflowsApi.get(step.workflow_id))
          } catch {
            details.push(null)
          }
        }
        setStepDetails(details)
        setExpandedSteps(new Set([0]))
      } else {
        setStepDetails([])
      }
    }).catch(() => setWorkflowDetail(null))
  }, [selectedId])

  // When face_ref param changes in face_swap mode, update default destination
  useEffect(() => {
    if (category !== 'face_swap' || !params.face_ref) return
    mediaApi.getByIds([params.face_ref]).then(items => {
      if (items.length > 0) {
        setResultPersonId(items[0].person_id ?? null)
        setResultAlbumId(null)
      }
    }).catch(() => {})
  }, [category, params.face_ref])

  const handleSubmit = useCallback(async () => {
    if (!workflowDetail || !category) return
    setSubmitting(true)
    try {
      const res = await tasksApi.batchAi({
        workflow_type: `custom:${workflowDetail.id}`,
        media_ids: mediaIds?.length ? mediaIds : undefined,
        album_id: albumId || undefined,
        source_param_name: sourceParamName,
        shared_params: { workflow_id: workflowDetail.id, ...params },
        target_person_id: resultPersonId || personId,
        result_album_id: resultAlbumId || undefined,
      })
      let msg = `已创建 ${res.tasks_created} 个任务`
      if (res.chains_created) msg += `（${res.chains_created} 个链式）`
      if (res.skipped_generated) msg += `（跳过 ${res.skipped_generated} 张 AI 生成图）`
      toast({ title: msg })
      onOpenChange(false)
      onComplete?.()
    } catch (err: any) {
      toast({ title: '提交失败', description: err.message, variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }, [workflowDetail, category, mediaIds, albumId, sourceParamName, params, personId, onOpenChange, onComplete])

  const canSubmit = useMemo(() => {
    if (!cat || !workflowDetail) return false
    // Check required params (excluding source image and mask)
    for (const p of cat.params) {
      if (SOURCE_IMAGE_NAMES.includes(p.name)) continue
      if (isMaskParam(p)) continue
      if (p.required && !params[p.name] && params[p.name] !== 0 && params[p.name] !== false) {
        return false
      }
    }
    return true
  }, [cat, workflowDetail, params])

  const pickerTitle = useMemo(() => {
    if (!pickerParam) return '选择图片'
    const catLabel = cat?.params.find(p => p.name === pickerParam)?.label
    const extraLabel = workflowDetail?.manifest?.extra_params?.find(ep => ep.name === pickerParam)?.label
    return `选择图片 — ${catLabel || extraLabel || pickerParam}`
  }, [pickerParam, cat, workflowDetail])

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[85vh] flex flex-col !gap-0 p-0">
          <DialogHeader className="px-6 pt-6 pb-3 shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5" />
              AI 批量处理
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 space-y-4 min-h-0" onWheel={e => e.stopPropagation()}>
            {/* Summary */}
            <div className="text-sm text-muted-foreground">
              {albumName
                ? `将为「${albumName}」中的本地图/截图批量执行 AI 任务（跳过 AI 生成图）`
                : `将为 ${totalImages} 张选中的本地图/截图批量执行 AI 任务（跳过 AI 生成图）`
              }
            </div>

            {/* Category selection */}
            <div className="space-y-1">
              <label className="text-sm font-medium">类别</label>
              <Select value={category} onValueChange={(v) => { setCategory(v); setSelectedId(''); setWorkflowDetail(null); setParams({}) }}>
                <SelectTrigger>
                  <SelectValue placeholder="选择 AI 类别..." />
                </SelectTrigger>
                <SelectContent>
                  {batchableCategories.map(c => (
                    <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Workflow selection */}
            {category && (
              catWorkflows.length > 0 ? (
                <div className="space-y-1">
                  <label className="text-sm font-medium">工作流</label>
                  <Select value={selectedId} onValueChange={setSelectedId}>
                    <SelectTrigger>
                      <SelectValue placeholder="选择工作流..." />
                    </SelectTrigger>
                    <SelectContent>
                      {catWorkflows.map(wf => (
                        <SelectItem key={wf.id} value={wf.id}>
                          {wf.name}{wf.is_default ? ' (默认)' : ''}{wf.is_composite ? ' (复合)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {workflowDetail?.description && (
                    <p className="text-xs text-muted-foreground">{workflowDetail.description}</p>
                  )}
                  {workflowDetail?.is_composite && workflowDetail.composite_steps && !workflowDetail.composite_steps.length && (
                    <div className="text-xs text-muted-foreground">无步骤</div>
                  )}
                </div>
              ) : (
                <div className="text-center py-4 text-muted-foreground text-sm">
                  该类别暂无已导入的工作流
                </div>
              )
            )}

            {/* Source image batch indicator */}
            {cat && workflowDetail && (
              <div className="flex items-center gap-2 px-2.5 py-2 rounded-md border border-dashed border-orange-500/40 bg-orange-500/5">
                <ClipboardList className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                <span className="text-xs text-muted-foreground flex-1">
                  {sourceParamName === 'base_image' ? '底图' : '源图'}：逐张自动填入（共 {totalImages} 张）
                </span>
                <span className="px-1.5 py-0.5 rounded bg-orange-500 text-white text-[10px] font-medium">批量</span>
              </div>
            )}

            {/* Composite workflow — colored step blocks */}
            {cat && workflowDetail?.is_composite && workflowDetail.composite_steps && (
              <div className="space-y-2">
                {workflowDetail.composite_steps.map((step, idx) => {
                  const stepColor = ['border-blue-500/40 bg-blue-500/5', 'border-purple-500/40 bg-purple-500/5', 'border-emerald-500/40 bg-emerald-500/5'][idx % 3]
                  const badgeColor = ['bg-blue-500', 'bg-purple-500', 'bg-emerald-500'][idx % 3]
                  const isExpanded = expandedSteps.has(idx)
                  const detail = stepDetails[idx]
                  const isFirstStep = idx === 0

                  return (
                    <div key={idx} className={`rounded-lg border ${stepColor} overflow-hidden`}>
                      <button
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent/30 transition-colors"
                        onClick={() => setExpandedSteps(prev => {
                          const next = new Set(prev)
                          if (next.has(idx)) next.delete(idx)
                          else next.add(idx)
                          return next
                        })}
                      >
                        <span className={`${badgeColor} text-white text-[10px] font-bold w-5 h-5 rounded flex items-center justify-center shrink-0`}>
                          {idx + 1}
                        </span>
                        <span className="flex-1 text-left truncate">{step.workflow_name || step.workflow_id.slice(0, 8)}</span>
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                      </button>

                      {isExpanded && detail && (
                        <div className="px-3 pb-3 space-y-2">
                          {/* Step 1: batch indicator; Step 2+: locked input */}
                          {isFirstStep ? (
                            <div className="flex items-center gap-2 px-2.5 py-2 rounded-md border border-dashed border-orange-500/40 bg-orange-500/5">
                              <ClipboardList className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                              <span className="text-xs text-muted-foreground">源图：逐张自动填入（共 {totalImages} 张）</span>
                              <span className="ml-auto px-1.5 py-0.5 rounded bg-orange-500 text-white text-[10px] font-medium">批量</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 px-2.5 py-2 rounded-md border border-dashed border-muted-foreground/30 bg-muted/50">
                              <Link2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                              <span className="text-xs text-muted-foreground">源图自动接收步骤 {idx} 的输出</span>
                              <span className={`ml-auto px-1.5 py-0.5 rounded text-[10px] font-medium ${badgeColor} text-white`}>来源</span>
                            </div>
                          )}

                          {/* Non-source params for this step */}
                          {isFirstStep ? (
                            <WorkflowParamForm
                              categoryParams={visibleParams}
                              extraParams={detail.manifest?.extra_params?.filter(ep => !isMaskParam(ep))}
                              params={params}
                              onParamChange={(name, value) => setParams(prev => ({ ...prev, [name]: value }))}
                              onParamClear={(name) => {
                                setParams(prev => { const { [name]: _, ...rest } = prev; return rest })
                                setMediaThumbs(prev => { const { [name]: _, ...rest } = prev; return rest })
                              }}
                              mediaThumbs={mediaThumbs}
                              maskPreview={{}}
                              onPickImage={setPickerParam}
                              onDrawMask={() => {}}
                              canDrawMask={false}
                            />
                          ) : (
                            <WorkflowParamForm
                              categoryParams={(() => {
                                const stepCat = categories.find(c => c.key === step.workflow_category)
                                if (!stepCat) return []
                                return stepCat.params.filter(p => !p.name || (!SOURCE_IMAGE_NAMES.includes(p.name) && !isMaskParam(p)))
                              })()}
                              extraParams={detail.manifest?.extra_params?.filter(ep => !isMaskParam(ep))}
                              params={params}
                              onParamChange={(name, value) => setParams(prev => ({ ...prev, [name]: value }))}
                              onParamClear={(name) => {
                                setParams(prev => { const { [name]: _, ...rest } = prev; return rest })
                                setMediaThumbs(prev => { const { [name]: _, ...rest } = prev; return rest })
                              }}
                              mediaThumbs={mediaThumbs}
                              maskPreview={{}}
                              onPickImage={setPickerParam}
                              onDrawMask={() => {}}
                              canDrawMask={false}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Non-composite: regular param form */}
            {cat && workflowDetail && !workflowDetail.is_composite && (
              <div className="space-y-3">
                <WorkflowParamForm
                  categoryParams={visibleParams}
                  extraParams={workflowDetail.manifest?.extra_params?.filter(ep => !isMaskParam(ep))}
                  params={params}
                  onParamChange={(name, value) => setParams(prev => ({ ...prev, [name]: value }))}
                  onParamClear={(name) => {
                    setParams(prev => { const { [name]: _, ...rest } = prev; return rest })
                    setMediaThumbs(prev => { const { [name]: _, ...rest } = prev; return rest })
                  }}
                  mediaThumbs={mediaThumbs}
                  maskPreview={{}}
                  onPickImage={setPickerParam}
                  onDrawMask={() => {}}
                  canDrawMask={false}
                />
              </div>
            )}

            {/* Result Destination */}
            {workflowDetail && (
              <div className="border-t border-border pt-1">
                <ResultDestination
                  personId={resultPersonId}
                  albumId={resultAlbumId}
                  onLocationChange={(pid, aid) => { setResultPersonId(pid); setResultAlbumId(aid) }}
                  linkParent={linkParent}
                  onLinkParentChange={setLinkParent}
                  batchMode
                />
              </div>
            )}

            {/* Task count summary */}
            {workflowDetail && (
              <p className="text-xs text-muted-foreground">
                {workflowDetail.is_composite && workflowDetail.composite_steps
                  ? `将创建 ${totalImages} 个链式任务（每个含 ${workflowDetail.composite_steps.length} 步）`
                  : `将创建 ${totalImages} 个任务`
                }
              </p>
            )}
          </div>

          {workflowDetail && (
            <DialogFooter className="gap-2 sm:gap-0 px-6 pb-6 pt-3 shrink-0 border-t border-border">
              <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
              <Button onClick={handleSubmit} disabled={submitting || !canSubmit}>
                {submitting && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                创建任务
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <FaceRefPicker
        open={!!pickerParam}
        onOpenChange={(v) => { if (!v) setPickerParam(null) }}
        title={pickerTitle}
        onSelect={(media) => {
          if (pickerParam) {
            setParams(prev => ({ ...prev, [pickerParam]: media.id }))
            setMediaThumbs(prev => ({
              ...prev,
              [pickerParam]: `/api/files/thumb?path=${encodeURIComponent(media.file_path)}&size=100`,
            }))
          }
          setPickerParam(null)
        }}
      />
    </>
  )
}
