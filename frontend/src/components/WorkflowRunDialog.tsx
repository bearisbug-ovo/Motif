import { useEffect, useState, useCallback, useMemo } from 'react'
import { Loader2, Link2, X, ArrowUpDown, Layers, ChevronDown, ChevronUp } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useWorkflowStore } from '@/stores/workflow'
import { useSystemStore } from '@/stores/system'
import { workflowsApi, WorkflowFull, CategoryParam, Category, WorkflowListItem } from '@/api/workflows'
import { tasksApi } from '@/api/tasks'
import { mediaApi, MediaItem } from '@/api/media'
import { FaceRefPicker } from './FaceRefPicker'
import { MaskEditor } from './MaskEditor'
import { CropEditor } from './CropEditor'
import { WorkflowParamForm, SOURCE_IMAGE_NAMES, isMaskParam } from './WorkflowParamForm'
import { ResultDestination } from './ResultDestination'
import { toast } from '@/hooks/use-toast'
import http from '@/api/http'

interface WorkflowRunDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  category: string
  sourceMedia: MediaItem | null
  /** Pre-select a specific workflow (used by "edit & create new" from task) */
  initialWorkflowId?: string
  /** Pre-fill param values (used by "edit & create new" from task) */
  initialParams?: Record<string, any>
}

function isSourceImageParam(p: CategoryParam) {
  return p.type === 'image' && SOURCE_IMAGE_NAMES.includes(p.name)
}

interface ChainStepState {
  categoryKey: string
  workflowId: string
  workflowDetail: WorkflowFull | null
  params: Record<string, any>
  mediaThumbs: Record<string, string>
  sourceParamName: string  // which param receives the previous step's output
}

export function WorkflowRunDialog({ open, onOpenChange, category, sourceMedia, initialWorkflowId, initialParams }: WorkflowRunDialogProps) {
  const { categories, workflows, fetchCategories, fetchWorkflows } = useWorkflowStore()
  const { status, fetchStatus } = useSystemStore()
  const comfyConnected = status?.comfyui.connected ?? false

  const [selectedId, setSelectedId] = useState<string>('')
  const [workflowDetail, setWorkflowDetail] = useState<WorkflowFull | null>(null)
  const [params, setParams] = useState<Record<string, any>>({})
  const [mediaThumbs, setMediaThumbs] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [pickerParam, setPickerParam] = useState<string | null>(null)
  const [maskEditorOpen, setMaskEditorOpen] = useState(false)
  const [maskParam, setMaskParam] = useState<string | null>(null)
  const [maskPreview, setMaskPreview] = useState<Record<string, string>>({})
  const [cropEditorOpen, setCropEditorOpen] = useState(false)
  const [cropParam, setCropParam] = useState<string | null>(null)
  const [cropPreview, setCropPreview] = useState<Record<string, string>>({})

  // First step sub-workflow detail (for composite workflows)
  const [firstStepDetail, setFirstStepDetail] = useState<WorkflowFull | null>(null)

  // Result destination state
  const [resultPersonId, setResultPersonId] = useState<string | null>(null)
  const [resultAlbumId, setResultAlbumId] = useState<string | null>(null)
  const [linkParent, setLinkParent] = useState(true)
  const [linkParentValue, setLinkParentValue] = useState<string>('')

  // Composite workflow step details
  const [stepDetails, setStepDetails] = useState<(WorkflowFull | null)[]>([])
  const [stepParams, setStepParams] = useState<Record<string, any>[]>([])
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set([0]))

  // Chain step state
  const [chainStep, setChainStep] = useState<ChainStepState | null>(null)
  const [chainPickerParam, setChainPickerParam] = useState<string | null>(null)

  const cat = useMemo(() => categories.find(c => c.key === category), [categories, category])
  const catWorkflows = useMemo(() => workflows.filter(w => w.category === category), [workflows, category])

  useEffect(() => {
    if (!open) return
    fetchCategories()
    fetchWorkflows()
    fetchStatus()
  }, [open, fetchCategories, fetchWorkflows, fetchStatus])

  useEffect(() => {
    if (!open || !catWorkflows.length) return
    // If initialWorkflowId is provided, pre-select it
    if (initialWorkflowId) {
      const match = catWorkflows.find(w => w.id === initialWorkflowId)
      if (match && selectedId !== match.id) {
        setSelectedId(match.id)
        return
      }
    }
    const def = catWorkflows.find(w => w.is_default) || catWorkflows[0]
    if (def && selectedId !== def.id) {
      setSelectedId(def.id)
    }
  }, [open, catWorkflows, initialWorkflowId])

  useEffect(() => {
    if (!open) {
      setSelectedId('')
      setWorkflowDetail(null)
      setFirstStepDetail(null)
      setParams({})
      setMediaThumbs({})
      setSubmitting(false)
      setPickerParam(null)
      setMaskEditorOpen(false)
      setMaskParam(null)
      Object.values(maskPreview).forEach(url => URL.revokeObjectURL(url))
      setMaskPreview({})
      setCropEditorOpen(false)
      setCropParam(null)
      Object.values(cropPreview).forEach(url => URL.revokeObjectURL(url))
      setCropPreview({})
      setChainStep(null)
      setChainPickerParam(null)
      setResultPersonId(null)
      setResultAlbumId(null)
      setLinkParent(true)
      setLinkParentValue('')
      setStepDetails([])
      setStepParams([])
      setExpandedSteps(new Set([0]))
    }
  }, [open])

  useEffect(() => {
    if (!selectedId) { setWorkflowDetail(null); setFirstStepDetail(null); setParams({}); return }
    workflowsApi.get(selectedId).then(async wf => {
      setWorkflowDetail(wf)
      const defaults: Record<string, any> = {}

      // For composite workflows, load the first step's sub-workflow for defaults & extra_params
      let firstStep: WorkflowFull | null = null
      if (wf.is_composite && wf.composite_steps?.length) {
        try {
          firstStep = await workflowsApi.get(wf.composite_steps[0].workflow_id)
          setFirstStepDetail(firstStep)
        } catch { setFirstStepDetail(null) }
      } else {
        setFirstStepDetail(null)
      }

      // Extract defaults from the effective workflow (first step for composite, self otherwise)
      const effectiveWf = firstStep || wf
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

      if (sourceMedia) {
        const catInfo = categories.find(c => c.key === wf.category)
        if (catInfo) {
          for (const p of catInfo.params) {
            if (isSourceImageParam(p)) {
              defaults[p.name] = sourceMedia.id
            }
          }
        }
      }

      // Merge initialParams (from "edit & create new" flow), overriding defaults
      if (initialParams) {
        for (const [k, v] of Object.entries(initialParams)) {
          if (k === 'workflow_id') continue  // internal, not a user param
          if (v !== undefined && v !== null && v !== '__chain_input__') {
            defaults[k] = v
          }
        }
      }

      setParams(defaults)
      setMediaThumbs({})
      setMaskPreview(prev => {
        Object.values(prev).forEach(url => URL.revokeObjectURL(url))
        return {}
      })

      // Initialize result destination based on source media
      if (wf.category === 'face_swap') {
        // For face_swap: default destination is the face_ref's person (散图)
        setLinkParentValue('face_ref')
        setLinkParent(true)
        // Look up face_ref media to get its person_id
        const faceRefId = defaults['face_ref']
        if (faceRefId) {
          mediaApi.getByIds([faceRefId]).then(items => {
            if (items.length > 0) {
              setResultPersonId(items[0].person_id ?? null)
              setResultAlbumId(null)  // 散图 (no album)
            }
          }).catch(() => {})
        } else if (sourceMedia) {
          setResultPersonId(sourceMedia.person_id ?? null)
          setResultAlbumId(null)
        }
      } else {
        if (sourceMedia) {
          setResultPersonId(sourceMedia.person_id ?? null)
          setResultAlbumId(sourceMedia.album_id ?? null)
        }
        setLinkParent(true)
        setLinkParentValue('')
      }

      // Load all composite step details
      if (wf.is_composite && wf.composite_steps?.length) {
        const details: (WorkflowFull | null)[] = []
        const paramsList: Record<string, any>[] = []
        for (const step of wf.composite_steps) {
          try {
            const stepWf = await workflowsApi.get(step.workflow_id)
            details.push(stepWf)
            // Extract defaults for this step
            const stepDefaults: Record<string, any> = {}
            if (stepWf.manifest?.mappings) {
              for (const [pn, mapping] of Object.entries(stepWf.manifest.mappings)) {
                if (mapping.type === 'image') continue
                const nd = stepWf.workflow_json?.[mapping.node_id]
                if (nd?.inputs?.[mapping.key] !== undefined) {
                  const v = nd.inputs[mapping.key]
                  if (!Array.isArray(v)) stepDefaults[pn] = v
                }
              }
            }
            if (stepWf.manifest?.extra_params) {
              for (const ep of stepWf.manifest.extra_params) {
                if (ep.type === 'image') continue
                const nd = stepWf.workflow_json?.[ep.node_id]
                if (nd?.inputs?.[ep.key] !== undefined) {
                  const v = nd.inputs[ep.key]
                  if (!Array.isArray(v)) stepDefaults[ep.name] = v
                }
              }
            }
            paramsList.push(stepDefaults)
          } catch {
            details.push(null)
            paramsList.push({})
          }
        }
        setStepDetails(details)
        setStepParams(paramsList)
        setExpandedSteps(new Set([0]))
      } else {
        setStepDetails([])
        setStepParams([])
      }
    }).catch(() => { setWorkflowDetail(null); setFirstStepDetail(null) })
  }, [selectedId, sourceMedia, categories])

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

  const getMaskBaseMedia = useCallback((): MediaItem | null => {
    if (!cat) return null
    const imageParams = cat.params.filter(p => p.type === 'image' && !isMaskParam(p) && params[p.name])
    if (imageParams.length === 0) return null
    const sourceParam = imageParams.find(p => isSourceImageParam(p))
    if (sourceParam && sourceMedia && params[sourceParam.name] === sourceMedia.id) {
      return sourceMedia
    }
    return sourceMedia
  }, [cat, params, sourceMedia])

  const handleMaskComplete = useCallback(async (blob: Blob) => {
    setMaskEditorOpen(false)
    if (!maskParam || !sourceMedia) return

    try {
      const form = new FormData()
      form.append('file', blob, 'mask.png')
      const { data: maskResult } = await http.post<{ mask_path: string }>(
        `/media/${sourceMedia.id}/upload-mask`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      )
      setParams(prev => ({ ...prev, [maskParam]: maskResult.mask_path }))
      const previewUrl = URL.createObjectURL(blob)
      setMaskPreview(prev => {
        if (prev[maskParam]) URL.revokeObjectURL(prev[maskParam])
        return { ...prev, [maskParam]: previewUrl }
      })
    } catch (err: any) {
      toast({ title: '遮罩上传失败', description: err.message, variant: 'destructive' })
    }
  }, [maskParam, sourceMedia])

  const handleCropComplete = useCallback(async (blob: Blob, _options?: any) => {
    setCropEditorOpen(false)
    if (!cropParam || !sourceMedia) return
    try {
      const result = await mediaApi.uploadCrop(sourceMedia.id, blob)
      setParams(prev => ({ ...prev, crop_path: result.crop_path }))
      const previewUrl = URL.createObjectURL(blob)
      setCropPreview(prev => {
        if (prev[cropParam]) URL.revokeObjectURL(prev[cropParam])
        return { ...prev, [cropParam]: previewUrl }
      })
      toast({ title: '裁剪预览已保存' })
    } catch (err: any) {
      toast({ title: '裁剪上传失败', description: err.message, variant: 'destructive' })
    }
  }, [cropParam, sourceMedia])

  // ── Chain step helpers ──────────────────────────────────────────────
  const handleAddChainStep = useCallback(() => {
    // Default to upscale category, fall back to first available
    const defaultCat = categories.find(c => c.key === 'upscale') || categories[0]
    if (!defaultCat) return
    const catWfs = workflows.filter(w => w.category === defaultCat.key)
    const defWf = catWfs.find(w => w.is_default) || catWfs[0]
    setChainStep({
      categoryKey: defaultCat.key,
      workflowId: defWf?.id || '',
      workflowDetail: null,
      params: {},
      mediaThumbs: {},
      sourceParamName: '',
    })
  }, [categories, workflows])

  const handleChainCategoryChange = useCallback((catKey: string) => {
    const catWfs = workflows.filter(w => w.category === catKey)
    const defWf = catWfs.find(w => w.is_default) || catWfs[0]
    setChainStep(prev => prev ? {
      ...prev,
      categoryKey: catKey,
      workflowId: defWf?.id || '',
      workflowDetail: null,
      params: {},
      mediaThumbs: {},
      sourceParamName: '',
    } : null)
  }, [workflows])

  const handleChainWorkflowChange = useCallback((wfId: string) => {
    setChainStep(prev => prev ? { ...prev, workflowId: wfId, workflowDetail: null, params: {}, mediaThumbs: {}, sourceParamName: '' } : null)
  }, [])

  // Load chain workflow detail when ID changes
  useEffect(() => {
    if (!chainStep?.workflowId) return
    workflowsApi.get(chainStep.workflowId).then(wf => {
      const defaults: Record<string, any> = {}
      if (wf.manifest?.mappings) {
        for (const [paramName, mapping] of Object.entries(wf.manifest.mappings)) {
          if (mapping.type === 'image') continue
          const nodeData = wf.workflow_json?.[mapping.node_id]
          if (nodeData?.inputs?.[mapping.key] !== undefined) {
            const val = nodeData.inputs[mapping.key]
            if (!Array.isArray(val)) defaults[paramName] = val
          }
        }
      }
      if (wf.manifest?.extra_params) {
        for (const ep of wf.manifest.extra_params) {
          if (ep.type === 'image') continue
          const nodeData = wf.workflow_json?.[ep.node_id]
          if (nodeData?.inputs?.[ep.key] !== undefined) {
            const val = nodeData.inputs[ep.key]
            if (!Array.isArray(val)) defaults[ep.name] = val
          }
        }
      }

      // Auto-detect source param name (first image param that isn't a mask)
      const chainCat = categories.find(c => c.key === wf.category)
      let autoSourceParam = ''
      if (chainCat) {
        const srcParam = chainCat.params.find(p => isSourceImageParam(p))
        if (srcParam) autoSourceParam = srcParam.name
        if (!autoSourceParam) {
          const firstImg = chainCat.params.find(p => p.type === 'image' && !isMaskParam(p))
          if (firstImg) autoSourceParam = firstImg.name
        }
      }

      setChainStep(prev => prev ? {
        ...prev,
        workflowDetail: wf,
        params: defaults,
        sourceParamName: autoSourceParam,
      } : null)
    }).catch(() => {})
  }, [chainStep?.workflowId, categories])

  // ── Submit ──────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async (execMode: 'immediate' | 'queued') => {
    if (!workflowDetail) return
    setSubmitting(true)

    // Build destination params
    const destParams: Record<string, any> = {}
    if (resultPersonId) destParams.target_person_id = resultPersonId
    if (resultAlbumId) destParams.result_album_id = resultAlbumId
    // For multi-source (face_swap): set result_owner for backend fallback + override parent
    if (linkParentValue && linkParentValue !== '__none__') {
      destParams.result_owner = linkParentValue
      const parentId = params[linkParentValue]
      if (parentId) destParams.parent_media_id_override = parentId
    }

    try {
      if (chainStep?.workflowDetail && chainStep.sourceParamName) {
        // Chain submission
        await tasksApi.createChain({
          first: {
            workflow_type: `custom:${workflowDetail.id}`,
            params: { workflow_id: workflowDetail.id, ...params, ...destParams },
            execution_mode: execMode,
          },
          then: [{
            workflow_type: `custom:${chainStep.workflowDetail.id}`,
            params: { workflow_id: chainStep.workflowDetail.id, ...chainStep.params },
            chain_source_param: chainStep.sourceParamName,
          }],
          execution_mode: execMode,
        })
        toast({ title: execMode === 'immediate' ? '链式任务已提交' : '链式任务已加入队列' })
      } else {
        // Single task
        await tasksApi.create({
          workflow_type: `custom:${workflowDetail.id}`,
          params: { workflow_id: workflowDetail.id, ...params, ...destParams },
          execution_mode: execMode,
        })
        toast({ title: execMode === 'immediate' ? '任务已提交' : '任务已加入队列' })
      }
      onOpenChange(false)
    } catch (e: any) {
      toast({ title: '创建任务失败', description: e.message, variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }, [workflowDetail, params, chainStep, onOpenChange, resultPersonId, resultAlbumId, linkParentValue])

  const canSubmit = useMemo(() => {
    if (!cat || !workflowDetail) return false
    // Composite workflows: validate first step's non-source required params
    if (workflowDetail.is_composite) {
      for (const p of cat.params) {
        if (isSourceImageParam(p)) continue  // auto-filled from sourceMedia
        if (isMaskParam(p)) continue
        if (p.required && !params[p.name] && params[p.name] !== 0 && params[p.name] !== false) {
          return false
        }
      }
      return true
    }
    for (const p of cat.params) {
      if (p.required && !params[p.name] && params[p.name] !== 0 && params[p.name] !== false) {
        return false
      }
    }
    // If chain step exists, validate it too
    if (chainStep) {
      if (!chainStep.workflowDetail || !chainStep.sourceParamName) return false
      const chainCat = categories.find(c => c.key === chainStep.categoryKey)
      if (chainCat) {
        for (const p of chainCat.params) {
          // Skip the source param that will be auto-filled from chain input
          if (p.name === chainStep.sourceParamName) continue
          if (p.required && !chainStep.params[p.name] && chainStep.params[p.name] !== 0 && chainStep.params[p.name] !== false) {
            return false
          }
        }
      }
    }
    return true
  }, [cat, workflowDetail, params, chainStep, categories, sourceMedia])

  const pickerTitle = useMemo(() => {
    const target = chainPickerParam || pickerParam
    if (!target) return '选择图片'
    if (chainPickerParam && chainStep) {
      const chainCat = categories.find(c => c.key === chainStep.categoryKey)
      const label = chainCat?.params.find(p => p.name === target)?.label
      return `选择图片 — ${label || target}`
    }
    const catLabel = cat?.params.find(p => p.name === target)?.label
    const extraLabel = workflowDetail?.manifest?.extra_params?.find(ep => ep.name === target)?.label
    return `选择图片 — ${catLabel || extraLabel || target}`
  }, [pickerParam, chainPickerParam, cat, workflowDetail, chainStep, categories])

  const chainCat = useMemo(() => chainStep ? categories.find(c => c.key === chainStep.categoryKey) : null, [chainStep, categories])
  const chainCatWorkflows = useMemo(() => chainStep ? workflows.filter(w => w.category === chainStep.categoryKey) : [], [chainStep, workflows])

  return (
    <>
      <Dialog open={open && !maskEditorOpen && !cropEditorOpen} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[85vh] flex flex-col !gap-0 p-0">
          <DialogHeader className="px-6 pt-6 pb-3 shrink-0">
            <DialogTitle>{cat?.label || category}</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 space-y-4 min-h-0" onWheel={e => e.stopPropagation()}>
          {sourceMedia && (
            <div className="flex items-center gap-3 p-2 bg-muted rounded-lg">
              <img
                src={mediaApi.itemThumbUrl(sourceMedia, 100)}
                alt=""
                className="w-16 h-16 rounded object-cover shrink-0"
              />
              <div className="min-w-0 text-sm">
                <p className="truncate text-muted-foreground">{sourceMedia.file_path.split(/[/\\]/).pop()}</p>
                {sourceMedia.width && sourceMedia.height && (
                  <p className="text-xs text-muted-foreground">{sourceMedia.width} × {sourceMedia.height}</p>
                )}
              </div>
            </div>
          )}

          {catWorkflows.length > 0 ? (
            <div className="space-y-1">
              <label className="text-sm font-medium">工作流</label>
              <Select value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger>
                  <SelectValue placeholder="选择工作流..." />
                </SelectTrigger>
                <SelectContent>
                  {catWorkflows.map(wf => (
                    <SelectItem key={wf.id} value={wf.id}>
                      {wf.name}{wf.is_default ? ' (默认)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {workflowDetail?.description && (
                <p className="text-xs text-muted-foreground">{workflowDetail.description}</p>
              )}
            </div>
          ) : (
            <div className="text-center py-6 text-muted-foreground text-sm">
              该类别暂无已导入的工作流
            </div>
          )}

          {/* Composite workflow overview + first step params */}
          {/* Composite workflow — colored step blocks */}
          {workflowDetail?.is_composite && workflowDetail.composite_steps && cat && (
            <div className="space-y-2">
              {workflowDetail.composite_steps.map((step, idx) => {
                const stepColor = ['border-blue-500/40 bg-blue-500/5', 'border-purple-500/40 bg-purple-500/5', 'border-emerald-500/40 bg-emerald-500/5'][idx % 3]
                const badgeColor = ['bg-blue-500', 'bg-purple-500', 'bg-emerald-500'][idx % 3]
                const isExpanded = expandedSteps.has(idx)
                const detail = stepDetails[idx]
                const isFirstStep = idx === 0

                return (
                  <div key={idx} className={`rounded-lg border ${stepColor} overflow-hidden`}>
                    {/* Step header — clickable to toggle */}
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
                      {step.workflow_category && (
                        <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-medium">
                          {step.workflow_category}
                        </span>
                      )}
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                    </button>

                    {/* Expanded content */}
                    {isExpanded && detail && (
                      <div className="px-3 pb-3 space-y-2">
                        {/* Locked source input for step 2+ */}
                        {!isFirstStep && (
                          <div className="flex items-center gap-2 px-2.5 py-2 rounded-md border border-dashed border-muted-foreground/30 bg-muted/50">
                            <Link2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <span className="text-xs text-muted-foreground">
                              源图自动接收步骤 {idx} 的输出
                            </span>
                            <span className={`ml-auto px-1.5 py-0.5 rounded text-[10px] font-medium ${badgeColor} text-white`}>来源</span>
                          </div>
                        )}

                        {/* Step params */}
                        {isFirstStep ? (
                          /* First step: use main params state, filter out auto-filled source images
                             For face_swap, base_image is user-selectable so keep it visible */
                          <>
                            <WorkflowParamForm
                              categoryParams={cat.params.filter(p => {
                                if (isMaskParam(p)) return false
                                if (!isSourceImageParam(p)) return true
                                // For face_swap, only hide the source_image (auto-filled), keep base_image visible
                                if (category === 'face_swap' && p.name === 'base_image') return true
                                return false
                              })}
                              extraParams={detail.manifest?.extra_params?.filter(ep => ep.type !== 'image' || ep.source !== 'file_path')}
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
                              sourceMedia={sourceMedia}
                              canDrawMask={false}
                            />
                            {/* Swap button for 2-image params */}
                            {(() => {
                              const imageParams = cat.params.filter(p => p.type === 'image' && !isMaskParam(p))
                              if (imageParams.length !== 2) return null
                              const [a, b] = imageParams
                              if (!params[a.name] && !params[b.name]) return null
                              return (
                                <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={() => {
                                  setParams(prev => ({ ...prev, [a.name]: prev[b.name], [b.name]: prev[a.name] }))
                                  setMediaThumbs(prev => ({ ...prev, [a.name]: prev[b.name], [b.name]: prev[a.name] }))
                                }}>
                                  <ArrowUpDown className="w-4 h-4" />
                                  交换{a.label}和{b.label}
                                </Button>
                              )
                            })()}
                          </>
                        ) : (
                          /* Later steps: use stepParams state, exclude source param */
                          <WorkflowParamForm
                            categoryParams={(() => {
                              const stepCat = categories.find(c => c.key === step.workflow_category)
                              if (!stepCat) return []
                              return stepCat.params.filter(p => !isSourceImageParam(p) && !isMaskParam(p))
                            })()}
                            extraParams={detail.manifest?.extra_params?.filter(ep => ep.type !== 'image' || ep.source !== 'file_path')}
                            params={stepParams[idx] || {}}
                            onParamChange={(name, value) => setStepParams(prev => {
                              const next = [...prev]
                              next[idx] = { ...next[idx], [name]: value }
                              return next
                            })}
                            onParamClear={(name) => setStepParams(prev => {
                              const next = [...prev]
                              const { [name]: _, ...rest } = next[idx] || {}
                              next[idx] = rest
                              return next
                            })}
                            mediaThumbs={{}}
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

          {cat && workflowDetail && !workflowDetail.is_composite && (
            <div className="space-y-3">
              <WorkflowParamForm
                categoryParams={cat.params}
                extraParams={workflowDetail.manifest?.extra_params}
                params={params}
                onParamChange={(name, value) => setParams(prev => ({ ...prev, [name]: value }))}
                onParamClear={(name) => {
                  setParams(prev => { const { [name]: _, ...rest } = prev; return rest })
                  setMediaThumbs(prev => { const { [name]: _, ...rest } = prev; return rest })
                  setMaskPreview(prev => {
                    if (prev[name]) URL.revokeObjectURL(prev[name])
                    const { [name]: _, ...rest } = prev
                    return rest
                  })
                }}
                mediaThumbs={mediaThumbs}
                maskPreview={maskPreview}
                onPickImage={setPickerParam}
                onDrawMask={(name) => { setMaskParam(name); setMaskEditorOpen(true) }}
                onCropImage={(name) => { setCropParam(name); setCropEditorOpen(true) }}
                cropPreview={cropPreview}
                sourceMedia={sourceMedia}
                canDrawMask={!!getMaskBaseMedia()}
              />
              {/* Swap button for 2-image params */}
              {(() => {
                const imageParams = cat.params.filter(p => p.type === 'image' && !isMaskParam(p))
                if (imageParams.length !== 2) return null
                const [a, b] = imageParams
                const aVal = params[a.name]
                const bVal = params[b.name]
                if (!aVal && !bVal) return null
                return (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-1.5"
                    onClick={() => {
                      setParams(prev => ({ ...prev, [a.name]: prev[b.name], [b.name]: prev[a.name] }))
                      setMediaThumbs(prev => ({ ...prev, [a.name]: prev[b.name], [b.name]: prev[a.name] }))
                    }}
                  >
                    <ArrowUpDown className="w-4 h-4" />
                    交换{a.label}和{b.label}
                  </Button>
                )
              })()}
            </div>
          )}

          {/* Chain Step 2 */}
          {chainStep && (
            <div className="border-t border-border pt-4 mt-2">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Link2 className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium">步骤 2 — 链接下一步</span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setChainStep(null)} className="h-6 w-6 p-0">
                  <X className="w-4 h-4" />
                </Button>
              </div>

              {/* Category selector */}
              <div className="space-y-1 mb-3">
                <label className="text-sm text-muted-foreground">类别</label>
                <Select value={chainStep.categoryKey} onValueChange={handleChainCategoryChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map(c => (
                      <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Workflow selector */}
              {chainCatWorkflows.length > 0 ? (
                <div className="space-y-1 mb-3">
                  <label className="text-sm text-muted-foreground">工作流</label>
                  <Select value={chainStep.workflowId} onValueChange={handleChainWorkflowChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="选择工作流..." />
                    </SelectTrigger>
                    <SelectContent>
                      {chainCatWorkflows.map(wf => (
                        <SelectItem key={wf.id} value={wf.id}>
                          {wf.name}{wf.is_default ? ' (默认)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="text-center py-4 text-muted-foreground text-sm">
                  该类别暂无已导入的工作流
                </div>
              )}

              {/* Source param indicator */}
              {chainStep.sourceParamName && (
                <div className="flex items-center gap-2 bg-muted rounded-md px-3 py-2 mb-3">
                  <Link2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs text-muted-foreground">
                    <strong>{chainCat?.params.find(p => p.name === chainStep.sourceParamName)?.label || chainStep.sourceParamName}</strong> 将自动接收上一步结果
                  </span>
                </div>
              )}

              {/* Chain step params (excluding the source param) */}
              {chainCat && chainStep.workflowDetail && (
                <div className="space-y-3">
                  <WorkflowParamForm
                    categoryParams={chainCat.params.filter(p => p.name !== chainStep.sourceParamName)}
                    extraParams={chainStep.workflowDetail.manifest?.extra_params}
                    params={chainStep.params}
                    onParamChange={(name, value) => setChainStep(prev => prev ? { ...prev, params: { ...prev.params, [name]: value } } : null)}
                    onParamClear={(name) => setChainStep(prev => {
                      if (!prev) return null
                      const { [name]: _, ...rest } = prev.params
                      const { [name]: __, ...thumbRest } = prev.mediaThumbs
                      return { ...prev, params: rest, mediaThumbs: thumbRest }
                    })}
                    mediaThumbs={chainStep.mediaThumbs}
                    maskPreview={{}}
                    onPickImage={(name) => setChainPickerParam(name)}
                    onDrawMask={() => {}}
                    canDrawMask={false}
                  />
                </div>
              )}
            </div>
          )}

          {/* Result Destination */}
          {workflowDetail && (
            <div className="border-t border-border pt-1 mt-2">
              {category === 'face_swap' ? (
                <ResultDestination
                  personId={resultPersonId}
                  albumId={resultAlbumId}
                  onLocationChange={(pid, aid) => { setResultPersonId(pid); setResultAlbumId(aid) }}
                  linkParentOptions={cat?.params.filter(p => p.type === 'image' && !isMaskParam(p)).map(p => ({ value: p.name, label: p.label })) || []}
                  linkParentValue={linkParentValue}
                  onLinkParentSelect={setLinkParentValue}
                />
              ) : (
                <ResultDestination
                  personId={resultPersonId}
                  albumId={resultAlbumId}
                  onLocationChange={(pid, aid) => { setResultPersonId(pid); setResultAlbumId(aid) }}
                  linkParent={linkParent}
                  onLinkParentChange={setLinkParent}
                />
              )}
            </div>
          )}
          </div>

          {workflowDetail && (
            <DialogFooter className="gap-2 sm:gap-0 px-6 pb-6 pt-3 shrink-0 border-t border-border">
              {!chainStep && !workflowDetail?.is_composite && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleAddChainStep}
                  disabled={submitting || !canSubmit}
                  className="mr-auto"
                  title="添加链式下一步"
                >
                  <Link2 className="w-4 h-4 mr-1" />
                  链接下一步
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => handleSubmit('queued')}
                disabled={submitting || !canSubmit}
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                加入队列
              </Button>
              <Button
                onClick={() => handleSubmit('immediate')}
                disabled={submitting || !canSubmit || !comfyConnected}
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                立即执行
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <FaceRefPicker
        open={!!(pickerParam || chainPickerParam)}
        onOpenChange={(v) => { if (!v) { setPickerParam(null); setChainPickerParam(null) } }}
        title={pickerTitle}
        onSelect={(media) => {
          if (chainPickerParam && chainStep) {
            setChainStep(prev => prev ? {
              ...prev,
              params: { ...prev.params, [chainPickerParam]: media.id },
              mediaThumbs: { ...prev.mediaThumbs, [chainPickerParam]: `/api/files/thumb?path=${encodeURIComponent(media.file_path)}&size=100` },
            } : null)
            setChainPickerParam(null)
          } else if (pickerParam) {
            setParams(prev => ({ ...prev, [pickerParam]: media.id }))
            setMediaThumbs(prev => ({
              ...prev,
              [pickerParam]: `/api/files/thumb?path=${encodeURIComponent(media.file_path)}&size=100`,
            }))
            setPickerParam(null)
          }
        }}
      />

      <MaskEditor
        open={maskEditorOpen}
        onClose={() => setMaskEditorOpen(false)}
        media={getMaskBaseMedia()}
        onComplete={handleMaskComplete}
      />

      <CropEditor
        open={cropEditorOpen}
        onClose={() => setCropEditorOpen(false)}
        media={sourceMedia}
        mode="temp"
        onComplete={handleCropComplete}
      />
    </>
  )
}
