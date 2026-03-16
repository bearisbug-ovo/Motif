import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Upload, X, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/hooks/use-toast'
import { confirm } from '@/components/ConfirmDialog'
import { useWorkflowStore } from '@/stores/workflow'
import { workflowsApi, ParseResult, WorkflowManifest } from '@/api/workflows'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const IMAGE_OUTPUT_CLASSES = new Set(['SaveImage', 'PreviewImage', 'ImageAndMaskPreview'])

interface Props {
  onClose: () => void
  onDone: () => void
  initialCategory?: string
  /** When provided, opens in edit mode — skips upload, pre-fills from existing workflow */
  editWorkflow?: { id: string; name: string; category: string; description: string | null; is_default: boolean; workflow_json: Record<string, any>; manifest: WorkflowManifest }
}

type Step = 'upload' | 'configure'

export function WorkflowImportDialog({ onClose, onDone, initialCategory, editWorkflow }: Props) {
  const { categories, fetchCategories, parseWorkflow, parseResult, parsing } = useWorkflowStore()
  const isEditMode = !!editWorkflow
  const [step, setStep] = useState<Step>(isEditMode ? 'configure' : 'upload')
  const [workflowJson, setWorkflowJson] = useState<Record<string, any> | null>(editWorkflow?.workflow_json || null)
  const [fileName, setFileName] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Config form state
  const [name, setName] = useState(editWorkflow?.name || '')
  const [category, setCategory] = useState(editWorkflow?.category || initialCategory || '')
  const [description, setDescription] = useState(editWorkflow?.description || '')
  const [isDefault, setIsDefault] = useState(editWorkflow?.is_default || false)
  const [mappings, setMappings] = useState<Record<string, { node_id: string; key: string; type: string; source?: string }>>({})
  const [nodeAssignments, setNodeAssignments] = useState<{
    node_id: string; name: string; class_type: string
    role: 'none' | 'input' | 'output' | 'both'
    scalars: { key: string; type: string; label: string; enabled: boolean; choices?: string[] }[]
    outputKey: string
    outputType: 'text' | 'image'
    isImageInput?: boolean
    imageSource?: 'media_id' | 'file_path'
    imageLabel?: string
  }[]>([])
  const [showRef, setShowRef] = useState(false)
  const [showParseSummary, setShowParseSummary] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const editInitialized = useRef(false)

  useEffect(() => {
    fetchCategories()
  }, [fetchCategories])

  // Edit mode: parse the existing workflow JSON to get parseResult
  useEffect(() => {
    if (!isEditMode || editInitialized.current || !editWorkflow.workflow_json) return
    editInitialized.current = true
    parseWorkflow(editWorkflow.workflow_json).catch(() => {})
  }, [isEditMode, editWorkflow, parseWorkflow])

  // Auto-map when category or parseResult changes
  useEffect(() => {
    if (!parseResult || !category) return
    const cat = categories.find(c => c.key === category)
    if (!cat) return

    const newMappings: typeof mappings = {}

    for (const param of cat.params) {
      // Try auto-match: find parsed node with matching suggested_name or node_title
      if (param.type === 'image') {
        const match = parseResult.image_inputs.find(
          inp => inp.suggested_name === param.name || inp.suggested_name.includes(param.name)
        )
        if (match) {
          newMappings[param.name] = {
            node_id: match.node_id,
            key: match.node_key,
            type: 'image',
            ...(param.source ? { source: param.source } : {}),
          }
        }
      } else {
        const match = parseResult.scalar_params.find(
          sp => sp.node_key === param.name || sp.node_title === param.name
            || sp.node_key.includes(param.name) || sp.node_title.includes(param.name)
        )
        if (match) {
          newMappings[param.name] = { node_id: match.node_id, key: match.node_key, type: param.type }
        }
      }
    }

    // In edit mode, restore saved mappings over auto-mapped ones
    if (isEditMode && editWorkflow?.manifest?.mappings) {
      for (const [paramName, saved] of Object.entries(editWorkflow.manifest.mappings)) {
        newMappings[paramName] = { ...saved }
      }
    }

    setMappings(newMappings)

    // Build unified node assignments for all unmapped @-tagged nodes
    const mappedNodeKeys = new Set(Object.values(newMappings).map(m => `${m.node_id}:${m.key}`))
    const catOutputs = cat.outputs || []
    const catOutputNames = new Set(catOutputs.map(o => o.name))

    const assignments: typeof nodeAssignments = parseResult.text_outputs.map(to => {
      // Gather scalar params for this node that aren't already category-mapped
      const nodeScalars = parseResult.scalar_params
        .filter(sp => sp.node_id === to.node_id && !mappedNodeKeys.has(`${sp.node_id}:${sp.node_key}`))
        .map(sp => ({ key: sp.node_key, type: sp.type, label: sp.node_key, enabled: true, ...(sp.choices ? { choices: sp.choices } : {}) }))

      // Auto-set role: category-defined outputs default to 'output', others to 'none'
      const isCatOutput = catOutputs.some(
        o => o.name === to.suggested_name || to.suggested_name.includes(o.name)
      )
      const defaultRole: typeof nodeAssignments[0]['role'] = isCatOutput ? 'output' : 'none'

      return {
        node_id: to.node_id,
        name: to.suggested_name,
        class_type: to.class_type,
        role: defaultRole,
        scalars: nodeScalars,
        outputKey: IMAGE_OUTPUT_CLASSES.has(to.class_type) ? 'images' : 'text',
        outputType: IMAGE_OUTPUT_CLASSES.has(to.class_type) ? 'image' as const : 'text' as const,
      }
    })

    // Add unmapped LoadImage nodes so they appear in custom parameter assignment
    const unmappedImages = parseResult.image_inputs.filter(
      inp => !mappedNodeKeys.has(`${inp.node_id}:${inp.node_key}`)
    )
    for (const inp of unmappedImages) {
      assignments.push({
        node_id: inp.node_id,
        name: inp.suggested_name,
        class_type: 'LoadImage',
        role: 'none',
        scalars: [],
        outputKey: '',
        outputType: 'image',
        isImageInput: true,
        imageSource: 'media_id',
        imageLabel: inp.suggested_name,
      })
    }

    // In edit mode, restore saved node assignment roles from manifest
    if (isEditMode && editWorkflow?.manifest) {
      const savedExtra = editWorkflow.manifest.extra_params || []
      const savedOutputs = editWorkflow.manifest.output_mappings || {}

      // Build lookup sets for fast matching
      const extraByNodeId = new Map<string, typeof savedExtra>()
      for (const ep of savedExtra) {
        const list = extraByNodeId.get(ep.node_id) || []
        list.push(ep)
        extraByNodeId.set(ep.node_id, list)
      }
      const outputByNodeId = new Map<string, { name: string; key: string; type?: string }>()
      for (const [oName, oMapping] of Object.entries(savedOutputs)) {
        outputByNodeId.set(oMapping.node_id, { name: oName, key: oMapping.key, type: oMapping.type })
      }

      for (const na of assignments) {
        const hasExtra = extraByNodeId.has(na.node_id)
        const hasOutput = outputByNodeId.has(na.node_id)

        if (hasExtra && hasOutput) na.role = 'both'
        else if (hasExtra) na.role = 'input'
        else if (hasOutput) na.role = 'output'

        // Restore scalar labels/enabled from saved extra_params
        if (hasExtra) {
          const eps = extraByNodeId.get(na.node_id)!
          if (na.isImageInput) {
            const imgEp = eps[0]
            if (imgEp) {
              na.imageLabel = imgEp.label || na.imageLabel
              na.imageSource = (imgEp as any).source === 'file_path' ? 'file_path' : 'media_id'
            }
          } else {
            for (const s of na.scalars) {
              const match = eps.find(ep => ep.key === s.key)
              if (match) {
                s.label = match.label || s.label
                s.enabled = true
                // Restore choices from saved manifest if not already set from object_info
                if (!s.choices && match.choices) {
                  s.choices = match.choices
                }
              } else {
                s.enabled = false
              }
            }
          }
        }

        // Restore output key/type
        if (hasOutput) {
          const o = outputByNodeId.get(na.node_id)!
          na.outputKey = o.name
          na.outputType = o.type === 'image' ? 'image' : 'text'
        }
      }
    }

    setNodeAssignments(assignments)
  }, [parseResult, category, categories, isEditMode, editWorkflow])

  const handleFile = useCallback(async (file: File) => {
    try {
      const text = await file.text()
      const json = JSON.parse(text)
      setWorkflowJson(json)
      setFileName(file.name)
      setName(file.name.replace(/\.json$/i, ''))
      const result = await parseWorkflow(json)
      setStep('configure')
    } catch (e: any) {
      toast({ title: '解析失败', description: e.message, variant: 'destructive' })
    }
  }, [parseWorkflow])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file?.name.endsWith('.json')) handleFile(file)
  }, [handleFile])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }, [handleFile])

  // Available options for mapping dropdowns
  const imageOptions = useMemo(() =>
    parseResult?.image_inputs.map(inp => ({
      value: `${inp.node_id}:${inp.node_key}`,
      label: `@${inp.suggested_name} (节点 ${inp.node_id})`,
      node_id: inp.node_id,
      key: inp.node_key,
    })) || [],
  [parseResult])

  const scalarOptions = useMemo(() =>
    parseResult?.scalar_params.map(sp => ({
      value: `${sp.node_id}:${sp.node_key}`,
      label: `@${sp.node_title}.${sp.node_key} (${sp.type})`,
      node_id: sp.node_id,
      key: sp.node_key,
      type: sp.type,
    })) || [],
  [parseResult])

  const selectedCategory = categories.find(c => c.key === category)
  const requiredMissing = selectedCategory?.params
    .filter(p => p.required)
    .some(p => !mappings[p.name])

  const handleSubmit = useCallback(async () => {
    if (!workflowJson || !category || !name.trim()) return

    // Derive extra_params and output_mappings from nodeAssignments
    const extraParams: { name: string; label: string; type: string; node_id: string; key: string; choices?: string[] }[] = []
    for (const na of nodeAssignments) {
      if (na.role !== 'input' && na.role !== 'both') continue
      if (na.isImageInput) {
        // LoadImage node → image-type extra param
        extraParams.push({
          name: na.name,
          label: na.imageLabel || na.name,
          type: 'image',
          node_id: na.node_id,
          key: 'image',
          ...(na.imageSource === 'file_path' ? { source: 'file_path' } : {}),
        })
      } else {
        for (const s of na.scalars) {
          if (!s.enabled) continue
          extraParams.push({
            name: `${na.name}.${s.key}`,
            label: s.label,
            type: s.type,
            node_id: na.node_id,
            key: s.key,
            ...(s.choices ? { choices: s.choices } : {}),
          })
        }
      }
    }
    const outputMappings: Record<string, { node_id: string; key: string; type?: string }> = {}
    for (const na of nodeAssignments) {
      if (na.role === 'output' || na.role === 'both') {
        const displayName = na.outputKey || na.name
        outputMappings[displayName] = {
          node_id: na.node_id,
          key: na.outputType === 'image' ? 'images' : 'text',
          ...(na.outputType === 'image' ? { type: 'image' } : {}),
        }
      }
    }
    const manifest: WorkflowManifest = {
      mappings,
      ...(Object.keys(outputMappings).length > 0 ? { output_mappings: outputMappings } : {}),
      ...(extraParams.length > 0 ? { extra_params: extraParams } : {}),
    }

    setSubmitting(true)
    try {
      if (isEditMode && editWorkflow) {
        // Update existing workflow
        await workflowsApi.update(editWorkflow.id, {
          name: name.trim(),
          description: description.trim() || undefined,
          workflow_json: workflowJson,
          manifest,
        })
        toast({ title: '工作流已更新' })
        onDone()
      } else {
        // Create new workflow
        await workflowsApi.create({
          name: name.trim(),
          category,
          description: description.trim() || undefined,
          is_default: isDefault,
          workflow_json: workflowJson,
          manifest,
        })
        toast({ title: '工作流已注册' })
        onDone()
      }
    } catch (e: any) {
      if (!isEditMode && e.message?.includes('already exists')) {
        if (await confirm({ title: `工作流「${name}」已存在，是否覆盖？`, variant: 'default' })) {
          try {
            const existing = await workflowsApi.list()
            const conflicting = existing.find(w => w.name === name.trim())
            if (conflicting) {
              await workflowsApi.create({
                name: name.trim(),
                category,
                description: description.trim() || undefined,
                is_default: isDefault,
                workflow_json: workflowJson,
                manifest,
                overwrite_id: conflicting.id,
              })
              toast({ title: '工作流已覆盖' })
              onDone()
              return
            }
          } catch (e2: any) {
            toast({ title: '覆盖失败', description: e2.message, variant: 'destructive' })
          }
        }
      } else {
        toast({ title: isEditMode ? '更新失败' : '注册失败', description: e.message, variant: 'destructive' })
      }
    } finally {
      setSubmitting(false)
    }
  }, [workflowJson, category, name, description, isDefault, mappings, nodeAssignments, onDone, isEditMode, editWorkflow])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-background rounded-lg shadow-lg w-full max-w-xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-base font-semibold">{isEditMode ? '编辑工作流' : '导入工作流'}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {step === 'upload' && (
            <div className="space-y-5">
              <div
                className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
                  dragOver ? 'border-primary bg-primary/5' : 'border-border'
                }`}
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              >
                {parsing ? (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Loader2 className="w-8 h-8 animate-spin" />
                    <p className="text-sm">解析中...</p>
                  </div>
                ) : (
                  <>
                    <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
                    <p className="text-sm text-muted-foreground mb-3">拖拽 ComfyUI API JSON 文件到此处</p>
                    <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                      选择文件
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".json"
                      className="hidden"
                      onChange={handleFileSelect}
                    />
                  </>
                )}
              </div>

              {/* Category parameter reference */}
              <div className="border border-border rounded-lg">
                <button
                  className="flex items-center gap-1.5 w-full px-4 py-2.5 text-sm font-medium text-left hover:bg-accent/50 transition-colors"
                  onClick={() => setShowRef(!showRef)}
                >
                  {showRef ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  参数参考（写工作流时查阅）
                </button>
                {showRef && (
                  <div className="px-4 pb-3 space-y-4">
                    <p className="text-xs text-muted-foreground">
                      在 ComfyUI 中将需要映射的节点的 Title 加上 <code className="px-1 py-0.5 rounded bg-muted font-mono">@</code> 前缀。
                      例如 LoadImage 节点改名为 <code className="px-1 py-0.5 rounded bg-muted font-mono">@base_image</code>。
                    </p>
                    {categories.map(cat => (
                      <div key={cat.key}>
                        <p className="text-sm font-medium mb-1.5">{cat.label} <span className="text-xs text-muted-foreground font-normal">({cat.key})</span></p>
                        <div className="space-y-0.5">
                          {cat.params.map(p => (
                            <div key={p.name} className="flex items-center gap-2 text-xs">
                              <code className="font-mono text-primary px-1 py-0.5 rounded bg-primary/5 shrink-0">@{p.name}</code>
                              <span className="text-muted-foreground shrink-0">{p.type}</span>
                              {p.required ? (
                                <span className="text-destructive text-[10px] shrink-0">必填</span>
                              ) : (
                                <span className="text-muted-foreground/50 text-[10px] shrink-0">可选</span>
                              )}
                            </div>
                          ))}
                          {cat.outputs?.map(o => (
                            <div key={o.name} className="flex items-center gap-2 text-xs">
                              <code className="font-mono text-orange-500 px-1 py-0.5 rounded bg-orange-500/5 shrink-0">@{o.name}</code>
                              <span className="text-muted-foreground shrink-0">{o.type}</span>
                              <span className="text-muted-foreground/50 text-[10px] shrink-0">输出</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 'configure' && parseResult && (
            <div className="space-y-5">
              {/* Basic info */}
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium mb-1 block">名称</label>
                  <Input value={name} onChange={e => setName(e.target.value)} placeholder="工作流名称" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">类别</label>
                  <Select value={category} onValueChange={setCategory} disabled={isEditMode}>
                    <SelectTrigger>
                      <SelectValue placeholder="选择类别..." />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map(c => (
                        <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">描述</label>
                  <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="可选" />
                </div>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} className="rounded border-input" />
                  设为该类别的默认工作流
                </label>
              </div>

              {/* Parameter mapping */}
              {selectedCategory && (
                <div className="space-y-3">
                  <h3 className="text-sm font-medium">参数映射</h3>
                  <p className="text-xs text-muted-foreground">将类别契约参数映射到工作流中的 @-标记节点</p>
                  <div className="space-y-2">
                    {selectedCategory.params.map(param => {
                      const current = mappings[param.name]
                      const options = param.type === 'image' ? imageOptions : scalarOptions
                      const currentValue = current ? `${current.node_id}:${current.key}` : ''

                      return (
                        <div key={param.name} className="flex items-center gap-2">
                          <span className="text-sm w-28 shrink-0">
                            {param.label}
                            {param.required && <span className="text-destructive ml-0.5">*</span>}
                          </span>
                          <Select
                            value={currentValue || '__none__'}
                            onValueChange={v => {
                              if (v === '__none__') {
                                const { [param.name]: _, ...rest } = mappings
                                setMappings(rest)
                                return
                              }
                              const opt = options.find(o => o.value === v)
                              if (opt) {
                                setMappings(prev => ({
                                  ...prev,
                                  [param.name]: {
                                    node_id: opt.node_id,
                                    key: opt.key,
                                    type: param.type,
                                    ...(param.source ? { source: param.source } : {}),
                                  },
                                }))
                              }
                            }}
                          >
                            <SelectTrigger className="flex-1 h-8 text-sm">
                              <SelectValue placeholder="选择节点参数..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">-- 未映射 --</SelectItem>
                              {options.map(opt => (
                                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Unified node assignment — assign each unmapped @-tagged node as input / output / both */}
              {nodeAssignments.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-medium">自定义参数分配</h3>
                  <p className="text-xs text-muted-foreground">
                    为每个未映射的 @-标记节点选择角色：额外输入参数、输出捕获或两者
                  </p>
                  <div className="space-y-3">
                    {nodeAssignments.map((na, ni) => (
                      <div key={na.node_id} className="border border-border rounded-lg px-3 py-2.5 space-y-2">
                        {/* Node header */}
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono text-primary font-medium">@{na.name}</span>
                          <span className="text-xs text-muted-foreground">{na.class_type}</span>
                          <span className="text-xs text-muted-foreground/50">#{na.node_id}</span>
                        </div>
                        {/* Role selector */}
                        <div className="flex gap-1 flex-wrap">
                          {(na.isImageInput
                            ? ['none', 'input'] as const
                            : ['none', 'input', 'output', 'both'] as const
                          ).map(role => (
                            <button
                              key={role}
                              className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                                na.role === role
                                  ? 'border-primary bg-primary/10 text-primary'
                                  : 'border-border text-muted-foreground hover:text-foreground'
                              }`}
                              onClick={() => {
                                const next = [...nodeAssignments]
                                next[ni] = { ...na, role }
                                setNodeAssignments(next)
                              }}
                            >
                              {{ none: '不使用', input: '输入', output: '输出', both: '输入+输出' }[role]}
                            </button>
                          ))}
                        </div>
                        {/* Input scalars — show when role is input or both */}
                        {(na.role === 'input' || na.role === 'both') && na.scalars.length > 0 && (
                          <div className="pl-2 space-y-1.5 border-l-2 border-primary/20 ml-1">
                            {na.scalars.map((s, si) => (
                              <div key={s.key} className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={s.enabled}
                                  onChange={e => {
                                    const next = [...nodeAssignments]
                                    const scalars = [...na.scalars]
                                    scalars[si] = { ...s, enabled: e.target.checked }
                                    next[ni] = { ...na, scalars }
                                    setNodeAssignments(next)
                                  }}
                                  className="rounded border-input shrink-0"
                                />
                                <span className="text-xs font-mono text-muted-foreground shrink-0">{s.key}</span>
                                <span className="text-xs text-muted-foreground/50 shrink-0">{s.type}{s.choices ? ' ▾' : ''}</span>
                                {s.enabled && (
                                  <Input
                                    className="w-24 h-6 text-xs ml-auto"
                                    value={s.label}
                                    onChange={e => {
                                      const next = [...nodeAssignments]
                                      const scalars = [...na.scalars]
                                      scalars[si] = { ...s, label: e.target.value }
                                      next[ni] = { ...na, scalars }
                                      setNodeAssignments(next)
                                    }}
                                    placeholder="标签"
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {(na.role === 'input' || na.role === 'both') && na.isImageInput && (
                          <div className="pl-2 space-y-2 border-l-2 border-primary/20 ml-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground shrink-0">类型:</span>
                              <div className="flex gap-1">
                                {([['media_id', '图片'], ['file_path', '遮罩']] as const).map(([src, label]) => (
                                  <button
                                    key={src}
                                    className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                                      na.imageSource === src
                                        ? 'border-primary bg-primary/10 text-primary'
                                        : 'border-border text-muted-foreground hover:text-foreground'
                                    }`}
                                    onClick={() => {
                                      const next = [...nodeAssignments]
                                      next[ni] = { ...na, imageSource: src }
                                      setNodeAssignments(next)
                                    }}
                                  >
                                    {label}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground shrink-0">标签:</span>
                              <Input
                                className="w-32 h-6 text-xs"
                                value={na.imageLabel || ''}
                                onChange={e => {
                                  const next = [...nodeAssignments]
                                  next[ni] = { ...na, imageLabel: e.target.value }
                                  setNodeAssignments(next)
                                }}
                                placeholder="显示名称"
                              />
                            </div>
                          </div>
                        )}
                        {(na.role === 'input' || na.role === 'both') && !na.isImageInput && na.scalars.length === 0 && (
                          <p className="text-xs text-muted-foreground/60 pl-3">该节点无可用标量输入</p>
                        )}
                        {/* Output config — show when role is output or both */}
                        {(na.role === 'output' || na.role === 'both') && (
                          <div className="flex items-center gap-2 pl-2 flex-wrap">
                            <span className="text-xs text-muted-foreground">输出标签:</span>
                            <Input
                              className="w-24 h-6 text-xs"
                              value={na.outputKey}
                              onChange={e => {
                                const next = [...nodeAssignments]
                                next[ni] = { ...na, outputKey: e.target.value }
                                setNodeAssignments(next)
                              }}
                              placeholder="输出名称"
                              title="任务详情中显示的输出参数名称"
                            />
                            <div className="flex gap-1 ml-auto">
                              {(['text', 'image'] as const).map(ot => (
                                <button
                                  key={ot}
                                  className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                                    na.outputType === ot
                                      ? 'border-primary bg-primary/10 text-primary'
                                      : 'border-border text-muted-foreground hover:text-foreground'
                                  }`}
                                  onClick={() => {
                                    const next = [...nodeAssignments]
                                    next[ni] = {
                                      ...na,
                                      outputType: ot,
                                      outputKey: ot === 'image' ? (na.outputKey === 'text' ? 'images' : na.outputKey) : (na.outputKey === 'images' ? 'text' : na.outputKey),
                                    }
                                    setNodeAssignments(next)
                                  }}
                                >
                                  {{ text: '文本', image: '图片' }[ot]}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Parse summary — collapsible */}
              <div className="border border-border rounded-lg">
                <button
                  className="flex items-center gap-1.5 w-full px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors text-left"
                  onClick={() => setShowParseSummary(!showParseSummary)}
                >
                  {showParseSummary ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  解析结果：{parseResult.image_inputs.length} 图片输入 · {parseResult.scalar_params.length} 标量参数 · {parseResult.output_nodes.length} 图片输出 · {parseResult.text_outputs.length} 文本输出
                </button>
                {showParseSummary && (
                  <div className="px-3 pb-3 space-y-3">
                    {parseResult.image_inputs.length > 0 && (
                      <div>
                        <p className="text-xs font-medium mb-1">图片输入</p>
                        <div className="space-y-0.5">
                          {parseResult.image_inputs.map(inp => (
                            <div key={`${inp.node_id}:${inp.node_key}`} className="text-xs text-muted-foreground flex gap-2">
                              <span className="text-primary font-mono">@{inp.suggested_name}</span>
                              <span className="opacity-60">节点 {inp.node_id} · {inp.node_key}</span>
                              {inp.current_value && <span className="opacity-40 truncate max-w-[120px]">= {String(inp.current_value)}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {parseResult.scalar_params.length > 0 && (
                      <div>
                        <p className="text-xs font-medium mb-1">标量参数</p>
                        <div className="space-y-0.5">
                          {parseResult.scalar_params.map(sp => (
                            <div key={`${sp.node_id}:${sp.node_key}`} className="text-xs text-muted-foreground flex gap-2">
                              <span className="text-primary font-mono">@{sp.node_title}.{sp.node_key}</span>
                              <span className="opacity-60">{sp.type}</span>
                              <span className="opacity-40 truncate max-w-[160px]">= {String(sp.current_value)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {parseResult.output_nodes.length > 0 && (
                      <div>
                        <p className="text-xs font-medium mb-1">图片输出</p>
                        <div className="space-y-0.5">
                          {parseResult.output_nodes.map(out => (
                            <div key={out.node_id} className="text-xs text-muted-foreground flex gap-2">
                              <span className="opacity-60">节点 {out.node_id}</span>
                              <span className="font-mono">{out.class_type}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {parseResult.text_outputs.length > 0 && (
                      <div>
                        <p className="text-xs font-medium mb-1">文本输出</p>
                        <div className="space-y-0.5">
                          {parseResult.text_outputs.map(to => (
                            <div key={to.node_id} className="text-xs text-muted-foreground flex gap-2">
                              <span className="text-primary font-mono">@{to.suggested_name}</span>
                              <span className="opacity-60">节点 {to.node_id}</span>
                              <span className="font-mono">{to.class_type}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'configure' && (
          <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
            {!isEditMode && (
              <Button variant="outline" onClick={() => { setStep('upload'); setWorkflowJson(null) }}>
                重新选择
              </Button>
            )}
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting || !name.trim() || !category || requiredMissing}
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
              {isEditMode ? '保存' : '注册工作流'}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
