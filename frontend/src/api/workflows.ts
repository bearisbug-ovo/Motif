import http from './http'

export interface CategoryParam {
  name: string
  type: 'image' | 'string' | 'int' | 'float' | 'bool'
  required: boolean
  label: string
  source?: string
}

export interface CategoryOutput {
  name: string
  type: string
  label: string
}

export interface Category {
  key: string
  label: string
  description: string
  usage: string
  params: CategoryParam[]
  outputs?: CategoryOutput[]
}

export interface WorkflowListItem {
  id: string
  name: string
  category: string
  description: string | null
  is_default: boolean
  is_composite: boolean
  composite_step_count?: number
  created_at: string
  updated_at: string
}

export interface CompositeStep {
  workflow_id: string
  params_override: Record<string, any>
  source_param: string
  workflow_name?: string
  workflow_category?: string
}

export interface WorkflowFull extends WorkflowListItem {
  workflow_json: Record<string, any>
  manifest: WorkflowManifest
  composite_steps?: CompositeStep[]
}

export interface WorkflowManifest {
  mappings: Record<string, { node_id: string; key: string; type: string; source?: string }>
  output_mappings?: Record<string, { node_id: string; key: string; type?: string }>
  extra_params?: { name: string; label: string; type: string; node_id: string; key: string; source?: string; choices?: string[] }[]
}

export interface ParseResult {
  image_inputs: { node_id: string; node_key: string; suggested_name: string; current_value: any }[]
  scalar_params: { node_id: string; node_key: string; type: string; current_value: any; node_title: string; choices?: string[] }[]
  output_nodes: { node_id: string; class_type: string }[]
  text_outputs: { node_id: string; suggested_name: string; class_type: string }[]
}

export const workflowsApi = {
  getCategories: () =>
    http.get<Category[]>('/workflow-categories').then(r => r.data),

  parse: (workflow_json: Record<string, any>) =>
    http.post<ParseResult>('/workflows/parse', { workflow_json }).then(r => r.data),

  list: (category?: string) =>
    http.get<WorkflowListItem[]>('/workflows', { params: category ? { category } : {} }).then(r => r.data),

  get: (id: string) =>
    http.get<WorkflowFull>(`/workflows/${id}`).then(r => r.data),

  create: (body: {
    name: string
    category: string
    description?: string
    is_default?: boolean
    workflow_json: Record<string, any>
    manifest: WorkflowManifest
    overwrite_id?: string
  }) =>
    http.post<WorkflowFull>('/workflows', body).then(r => r.data),

  update: (id: string, body: {
    name?: string
    description?: string
    workflow_json?: Record<string, any>
    manifest?: WorkflowManifest
  }) =>
    http.put<WorkflowFull>(`/workflows/${id}`, body).then(r => r.data),

  delete: (id: string) =>
    http.delete(`/workflows/${id}`),

  setDefault: (id: string) =>
    http.patch<WorkflowListItem>(`/workflows/${id}/default`).then(r => r.data),

  createComposite: (body: {
    name: string
    description?: string
    steps: { workflow_id: string; params_override?: Record<string, any> }[]
  }) =>
    http.post<WorkflowFull>('/workflows/composite', body).then(r => r.data),
}
