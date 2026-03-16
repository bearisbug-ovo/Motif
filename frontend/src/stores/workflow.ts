import { create } from 'zustand'
import { workflowsApi, Category, WorkflowListItem, ParseResult } from '@/api/workflows'

interface WorkflowStore {
  categories: Category[]
  workflows: WorkflowListItem[]
  loading: boolean
  parseResult: ParseResult | null
  parsing: boolean

  fetchCategories: () => Promise<void>
  fetchWorkflows: (category?: string) => Promise<void>
  parseWorkflow: (json: Record<string, any>) => Promise<ParseResult>
  clearParseResult: () => void
  deleteWorkflow: (id: string) => Promise<void>
  setDefault: (id: string) => Promise<void>
}

export const useWorkflowStore = create<WorkflowStore>((set, get) => ({
  categories: [],
  workflows: [],
  loading: false,
  parseResult: null,
  parsing: false,

  fetchCategories: async () => {
    try {
      const categories = await workflowsApi.getCategories()
      set({ categories })
    } catch {}
  },

  fetchWorkflows: async (category?: string) => {
    set({ loading: true })
    try {
      const workflows = await workflowsApi.list(category)
      set({ workflows, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  parseWorkflow: async (json) => {
    set({ parsing: true })
    try {
      const result = await workflowsApi.parse(json)
      set({ parseResult: result, parsing: false })
      return result
    } catch (e) {
      set({ parsing: false })
      throw e
    }
  },

  clearParseResult: () => set({ parseResult: null }),

  deleteWorkflow: async (id) => {
    await workflowsApi.delete(id)
    const { workflows } = get()
    set({ workflows: workflows.filter(w => w.id !== id) })
  },

  setDefault: async (id) => {
    const result = await workflowsApi.setDefault(id)
    const { workflows } = get()
    set({
      workflows: workflows.map(w => ({
        ...w,
        is_default: w.id === id ? true : (w.category === result.category ? false : w.is_default),
      })),
    })
  },
}))
