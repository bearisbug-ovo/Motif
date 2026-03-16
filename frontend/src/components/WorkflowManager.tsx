import { useEffect, useState, useCallback, useMemo } from 'react'
import { Plus, Star, Trash2, Loader2, Info, Eye, Save, Pencil, Layers } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ContextMenuPortal, MenuItem, MenuSeparator } from './ContextMenuPortal'
import { toast } from '@/hooks/use-toast'
import { confirm } from '@/components/ConfirmDialog'
import { useWorkflowStore } from '@/stores/workflow'
import { workflowsApi, Category, WorkflowFull, WorkflowListItem, WorkflowManifest } from '@/api/workflows'
import { cn } from '@/lib/utils'
import { WorkflowImportDialog } from './WorkflowImportDialog'
import { CompositeWorkflowDialog } from './CompositeWorkflowDialog'

export function WorkflowManager() {
  const { categories, workflows, loading, fetchCategories, fetchWorkflows, deleteWorkflow, setDefault } = useWorkflowStore()
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [showImport, setShowImport] = useState(false)
  const [editWf, setEditWf] = useState<WorkflowFull | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; wf: WorkflowListItem } | null>(null)
  const [showComposite, setShowComposite] = useState(false)
  const [compositeInitWf, setCompositeInitWf] = useState<WorkflowListItem | null>(null)

  useEffect(() => {
    fetchCategories()
    fetchWorkflows()
  }, [fetchCategories, fetchWorkflows])

  const handleFilterChange = useCallback((cat: string) => {
    setCategoryFilter(cat)
    fetchWorkflows(cat || undefined)
  }, [fetchWorkflows])

  const handleDelete = useCallback(async (id: string, name: string) => {
    if (!await confirm({ title: `确定要删除工作流「${name}」吗？` })) return
    try {
      await deleteWorkflow(id)
      toast({ title: '已删除' })
    } catch (e: any) {
      toast({ title: '删除失败', description: e.message, variant: 'destructive' })
    }
  }, [deleteWorkflow])

  const handleSetDefault = useCallback(async (id: string) => {
    try {
      await setDefault(id)
      toast({ title: '已设为默认' })
    } catch (e: any) {
      toast({ title: '操作失败', description: e.message, variant: 'destructive' })
    }
  }, [setDefault])

  const handleEdit = useCallback(async (id: string) => {
    try {
      const full = await workflowsApi.get(id)
      setEditWf(full)
    } catch (e: any) {
      toast({ title: '加载失败', description: e.message, variant: 'destructive' })
    }
  }, [])

  const handleImportDone = useCallback(() => {
    setShowImport(false)
    setEditWf(null)
    fetchWorkflows(categoryFilter || undefined)
  }, [fetchWorkflows, categoryFilter])

  const categoryLabel = (key: string) => categories.find(c => c.key === key)?.label || key

  return (
    <div className="space-y-6">
      {/* Category filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          className={cn(
            'px-3 py-1 text-sm rounded-full border transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring',
            !categoryFilter ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'
          )}
          onClick={() => handleFilterChange('')}
        >
          全部
        </button>
        {categories.map(cat => (
          <button
            key={cat.key}
            className={cn(
              'px-3 py-1 text-sm rounded-full border transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring',
              categoryFilter === cat.key ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'
            )}
            onClick={() => handleFilterChange(cat.key)}
          >
            {cat.label}
          </button>
        ))}
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => setShowComposite(true)} className="gap-1.5">
          <Layers className="w-4 h-4" />
          创建复合工作流
        </Button>
        <Button size="sm" onClick={() => setShowImport(true)} className="gap-1.5">
          <Plus className="w-4 h-4" />
          导入工作流
        </Button>
      </div>

      {/* Category reference card (only when a specific category is selected) */}
      {categoryFilter && (
        <CategoryCards
          categories={categories.filter(c => c.key === categoryFilter)}
        />
      )}

      {/* Workflow list */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          加载中...
        </div>
      ) : workflows.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          暂无工作流，点击「导入工作流」添加
        </div>
      ) : (
        <div className="space-y-2">
          {workflows.map(wf => (
            <div
              key={wf.id}
              className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-accent/50 transition-colors cursor-pointer"
              onClick={() => setDetailId(wf.id)}
              onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, wf }) }}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{wf.name}</span>
                  {wf.is_default && (
                    <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500 shrink-0" />
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                  <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-medium">
                    {categoryLabel(wf.category)}
                  </span>
                  {wf.is_composite && (
                    <span className="px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-500 text-[10px] font-medium">
                      复合{wf.composite_step_count ? ` · ${wf.composite_step_count}步` : ''}
                    </span>
                  )}
                  {wf.description && <span className="truncate">{wf.description}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                {!wf.is_default && (
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleSetDefault(wf.id)} title="设为默认">
                    <Star className="w-3.5 h-3.5" />
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(wf.id, wf.name)} title="删除">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {ctxMenu && (
        <ContextMenuPortal position={{ x: ctxMenu.x, y: ctxMenu.y }} onClose={() => setCtxMenu(null)}>
          <MenuItem
            icon={<Eye className="w-3.5 h-3.5" />}
            label="查看详情"
            onClick={() => { setDetailId(ctxMenu.wf.id); setCtxMenu(null) }}
          />
          <MenuItem
            icon={<Pencil className="w-3.5 h-3.5" />}
            label="编辑配置"
            onClick={() => { handleEdit(ctxMenu.wf.id); setCtxMenu(null) }}
          />
          {!ctxMenu.wf.is_default && (
            <MenuItem
              icon={<Star className="w-3.5 h-3.5" />}
              label="设为默认"
              onClick={() => { handleSetDefault(ctxMenu.wf.id); setCtxMenu(null) }}
            />
          )}
          <MenuItem
            icon={<Layers className="w-3.5 h-3.5" />}
            label="以此创建复合工作流"
            onClick={() => { setCompositeInitWf(ctxMenu.wf); setShowComposite(true); setCtxMenu(null) }}
          />
          <MenuSeparator />
          <MenuItem
            icon={<Trash2 className="w-3.5 h-3.5" />}
            label="删除"
            destructive
            onClick={() => { handleDelete(ctxMenu.wf.id, ctxMenu.wf.name); setCtxMenu(null) }}
          />
        </ContextMenuPortal>
      )}

      {showImport && (
        <WorkflowImportDialog
          onClose={() => setShowImport(false)}
          onDone={handleImportDone}
          initialCategory={categoryFilter}
        />
      )}

      {editWf && (
        <WorkflowImportDialog
          onClose={() => setEditWf(null)}
          onDone={handleImportDone}
          editWorkflow={editWf}
        />
      )}

      <WorkflowDetailDialog
        workflowId={detailId}
        categories={categories}
        onClose={() => setDetailId(null)}
        onEdit={(wf) => { setDetailId(null); setEditWf(wf) }}
      />

      <CompositeWorkflowDialog
        open={showComposite}
        onOpenChange={(v) => { setShowComposite(v); if (!v) setCompositeInitWf(null) }}
        onDone={() => fetchWorkflows(categoryFilter || undefined)}
        initialWorkflow={compositeInitWf}
      />
    </div>
  )
}

function WorkflowDetailDialog({ workflowId, categories, onClose, onEdit }: {
  workflowId: string | null
  categories: Category[]
  onClose: () => void
  onEdit?: (wf: WorkflowFull) => void
}) {
  const { fetchWorkflows } = useWorkflowStore()
  const [wf, setWf] = useState<WorkflowFull | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  // Edited defaults: key = "param:<paramName>" or "extra:<epName>", value = edited value
  const [edits, setEdits] = useState<Record<string, any>>({})

  useEffect(() => {
    if (!workflowId) { setWf(null); setEdits({}); return }
    setLoading(true)
    setEdits({})
    workflowsApi.get(workflowId)
      .then(setWf)
      .catch(() => { setWf(null); toast({ title: '加载失败', variant: 'destructive' }) })
      .finally(() => setLoading(false))
  }, [workflowId])

  const cat = wf ? categories.find(c => c.key === wf.category) : null

  // Build param rows
  const paramRows = useMemo(() => {
    if (!wf || !cat) return []
    return cat.params.map(p => {
      const mapping = wf.manifest?.mappings?.[p.name]
      let defaultValue: any = undefined
      if (mapping) {
        const nodeData = wf.workflow_json?.[mapping.node_id]
        const val = nodeData?.inputs?.[mapping.key]
        if (val !== undefined && !Array.isArray(val)) {
          defaultValue = val
        }
      }
      return {
        name: p.name,
        label: p.label,
        type: p.type,
        required: p.required,
        nodeId: mapping?.node_id,
        nodeKey: mapping?.key,
        defaultValue,
        mapped: !!mapping,
      }
    })
  }, [wf, cat])

  // Extra params rows
  const extraRows = useMemo(() => {
    if (!wf?.manifest?.extra_params) return []
    return wf.manifest.extra_params.map(ep => {
      let defaultValue: any = undefined
      const nodeData = wf.workflow_json?.[ep.node_id]
      const val = nodeData?.inputs?.[ep.key]
      if (val !== undefined && !Array.isArray(val)) {
        defaultValue = val
      }
      return { ...ep, defaultValue }
    })
  }, [wf])

  // Output mappings
  const outputRows = useMemo(() => {
    if (!wf?.manifest?.output_mappings) return []
    return Object.entries(wf.manifest.output_mappings).map(([name, m]) => ({
      name,
      nodeId: m.node_id,
      key: m.key,
      type: m.type,
    }))
  }, [wf])

  const hasEdits = Object.keys(edits).length > 0

  const handleSave = useCallback(async () => {
    if (!wf || !hasEdits) return
    setSaving(true)
    try {
      // Deep clone workflow_json and apply edits
      const newJson = JSON.parse(JSON.stringify(wf.workflow_json))
      for (const [editKey, editVal] of Object.entries(edits)) {
        if (editKey.startsWith('param:')) {
          const paramName = editKey.slice(6)
          const mapping = wf.manifest?.mappings?.[paramName]
          if (mapping && newJson[mapping.node_id]?.inputs) {
            newJson[mapping.node_id].inputs[mapping.key] = editVal
          }
        } else if (editKey.startsWith('extra:')) {
          const epName = editKey.slice(6)
          const ep = wf.manifest?.extra_params?.find(e => e.name === epName)
          if (ep && newJson[ep.node_id]?.inputs) {
            newJson[ep.node_id].inputs[ep.key] = editVal
          }
        }
      }
      const updated = await workflowsApi.update(wf.id, { workflow_json: newJson })
      setWf(updated)
      setEdits({})
      fetchWorkflows()
      toast({ title: '默认参数已保存' })
    } catch (e: any) {
      toast({ title: '保存失败', description: e.message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }, [wf, edits, hasEdits, fetchWorkflows])

  return (
    <Dialog open={!!workflowId} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {wf?.name || '工作流详情'}
            <div className="flex items-center gap-1.5 ml-auto">
              {wf && onEdit && (
                <Button variant="outline" size="sm" className="h-7 gap-1" onClick={() => { onEdit(wf); onClose() }}>
                  <Pencil className="w-3.5 h-3.5" />
                  编辑配置
                </Button>
              )}
              {hasEdits && (
                <Button size="sm" className="h-7 gap-1" onClick={handleSave} disabled={saving}>
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  保存
                </Button>
              )}
            </div>
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            加载中...
          </div>
        ) : wf ? (
          <div className="flex-1 overflow-y-auto space-y-4">
            {/* Basic info */}
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2">
                <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-medium">
                  {cat?.label || wf.category}
                </span>
                {wf.is_default && (
                  <span className="px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-500 text-[10px] font-medium">默认</span>
                )}
              </div>
              {wf.description && (
                <p className="text-muted-foreground">{wf.description}</p>
              )}
            </div>

            {/* Input params */}
            <div>
              <h3 className="text-xs font-medium text-muted-foreground mb-2">输入参数</h3>
              {paramRows.length > 0 ? (
                <div className="space-y-2">
                  {paramRows.map(p => {
                    const editKey = `param:${p.name}`
                    const isEditing = editKey in edits
                    const displayVal = isEditing ? edits[editKey] : p.defaultValue
                    const isEditable = p.mapped && p.type !== 'image'
                    return (
                      <div key={p.name} className="flex items-start gap-3 py-1.5 border-b border-border/50 last:border-0">
                        <div className="w-28 shrink-0">
                          <div className="text-sm font-medium">{p.label}</div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="px-1 py-0.5 rounded bg-muted text-[10px]">{p.type}</span>
                            {p.required && <span className="text-destructive text-[10px]">必填</span>}
                          </div>
                          {p.mapped && (
                            <code className="text-[10px] text-muted-foreground/60 font-mono">#{p.nodeId}.{p.nodeKey}</code>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          {!p.mapped ? (
                            <span className="text-destructive text-xs">未映射</span>
                          ) : p.type === 'image' ? (
                            <span className="text-muted-foreground/50 text-xs">—</span>
                          ) : p.type === 'string' ? (
                            <textarea
                              className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none font-mono"
                              rows={2}
                              value={displayVal ?? ''}
                              onChange={e => setEdits(prev => ({ ...prev, [editKey]: e.target.value }))}
                            />
                          ) : p.type === 'bool' ? (
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={!!displayVal}
                                onChange={e => setEdits(prev => ({ ...prev, [editKey]: e.target.checked }))}
                                className="rounded border-input"
                              />
                              <span className="text-xs">{displayVal ? '是' : '否'}</span>
                            </label>
                          ) : (
                            <Input
                              className="h-7 text-xs font-mono"
                              type="number"
                              step={p.type === 'float' ? '0.01' : '1'}
                              value={displayVal ?? ''}
                              onChange={e => {
                                const v = p.type === 'float' ? parseFloat(e.target.value) : parseInt(e.target.value)
                                setEdits(prev => ({ ...prev, [editKey]: isNaN(v) ? '' : v }))
                              }}
                            />
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">无参数定义</p>
              )}
            </div>

            {/* Extra params */}
            {extraRows.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-muted-foreground mb-2">额外参数</h3>
                <div className="space-y-2">
                  {extraRows.map(ep => {
                    const editKey = `extra:${ep.name}`
                    const isEditing = editKey in edits
                    const displayVal = isEditing ? edits[editKey] : ep.defaultValue
                    return (
                      <div key={ep.name} className="flex items-start gap-3 py-1.5 border-b border-border/50 last:border-0">
                        <div className="w-28 shrink-0">
                          <div className="text-sm font-medium">{ep.label || ep.name}</div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="px-1 py-0.5 rounded bg-muted text-[10px]">{ep.type}</span>
                          </div>
                          <code className="text-[10px] text-muted-foreground/60 font-mono">#{ep.node_id}.{ep.key}</code>
                        </div>
                        <div className="flex-1 min-w-0">
                          {ep.choices && ep.choices.length > 0 ? (
                            <Select value={displayVal ?? ''} onValueChange={v => setEdits(prev => ({ ...prev, [editKey]: v }))}>
                              <SelectTrigger className="h-7 text-xs font-mono">
                                <SelectValue placeholder="选择..." />
                              </SelectTrigger>
                              <SelectContent>
                                {ep.choices.map((c: string) => (
                                  <SelectItem key={c} value={c}>{c}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : ep.type === 'string' ? (
                            <textarea
                              className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none font-mono"
                              rows={2}
                              value={displayVal ?? ''}
                              onChange={e => setEdits(prev => ({ ...prev, [editKey]: e.target.value }))}
                            />
                          ) : ep.type === 'bool' ? (
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={!!displayVal}
                                onChange={e => setEdits(prev => ({ ...prev, [editKey]: e.target.checked }))}
                                className="rounded border-input"
                              />
                              <span className="text-xs">{displayVal ? '是' : '否'}</span>
                            </label>
                          ) : (
                            <Input
                              className="h-7 text-xs font-mono"
                              type="number"
                              step={ep.type === 'float' ? '0.01' : '1'}
                              value={displayVal ?? ''}
                              onChange={e => {
                                const v = ep.type === 'float' ? parseFloat(e.target.value) : parseInt(e.target.value)
                                setEdits(prev => ({ ...prev, [editKey]: isNaN(v) ? '' : v }))
                              }}
                            />
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Output mappings */}
            {outputRows.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-muted-foreground mb-2">输出映射</h3>
                <div className="space-y-1">
                  {outputRows.map(o => (
                    <div key={o.name} className="flex items-center gap-2 text-sm py-1 border-b border-border/50 last:border-0">
                      <span className="font-medium">{o.name}</span>
                      {o.type === 'image' && <span className="px-1 py-0.5 rounded bg-muted text-[10px]">图片</span>}
                      <code className="text-[10px] text-muted-foreground font-mono ml-auto">#{o.nodeId}.{o.key}</code>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Workflow ID */}
            <div className="text-[10px] text-muted-foreground/50 font-mono pt-2 border-t border-border">
              ID: {wf.id}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function CategoryCards({ categories }: { categories: Category[] }) {
  if (categories.length === 0) return null

  return (
    <div className="space-y-3">
      {categories.map(cat => (
        <div key={cat.key} className="rounded-lg border border-border p-4 space-y-3">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-primary mt-0.5 shrink-0" />
            <div>
              <h3 className="text-sm font-semibold">{cat.label} <span className="text-muted-foreground font-normal">({cat.key})</span></h3>
              <p className="text-sm text-muted-foreground mt-0.5">{cat.description}</p>
            </div>
          </div>

          <div className="bg-muted/40 rounded-md px-3 py-2">
            <p className="text-sm text-muted-foreground">{cat.usage}</p>
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">参数约定</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border">
                  <th className="text-left pb-1.5 font-medium">节点标记</th>
                  <th className="text-left pb-1.5 font-medium">说明</th>
                  <th className="text-left pb-1.5 font-medium">类型</th>
                  <th className="text-left pb-1.5 font-medium">必填</th>
                </tr>
              </thead>
              <tbody>
                {cat.params.map(p => (
                  <tr key={p.name} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5 pr-3">
                      <code className="font-mono text-primary">@{p.name}</code>
                    </td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{p.label}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{p.type}</td>
                    <td className="py-1.5 pr-3">
                      {p.required
                        ? <span className="text-destructive">是</span>
                        : <span className="text-muted-foreground/50">否</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}
