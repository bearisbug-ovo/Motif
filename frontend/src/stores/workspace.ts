import { create } from 'zustand'
import { workspaceApi, WorkspaceItem } from '@/api/workspace'

interface WorkspaceStore {
  items: WorkspaceItem[]
  loading: boolean

  fetchItems: () => Promise<void>
  addItem: (mediaId: string) => Promise<void>
  batchAdd: (mediaIds: string[]) => Promise<{ added: number; skipped: number; total: number }>
  removeItem: (itemId: string) => Promise<void>
  clear: () => Promise<void>
  reorder: (itemIds: string[]) => Promise<void>
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  items: [],
  loading: false,

  fetchItems: async () => {
    set({ loading: true })
    try {
      const items = await workspaceApi.list()
      set({ items, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  addItem: async (mediaId: string) => {
    await workspaceApi.add(mediaId)
    await get().fetchItems()
  },

  batchAdd: async (mediaIds: string[]) => {
    const result = await workspaceApi.batchAdd(mediaIds)
    await get().fetchItems()
    return result
  },

  removeItem: async (itemId: string) => {
    await workspaceApi.remove(itemId)
    set({ items: get().items.filter(i => i.id !== itemId) })
  },

  clear: async () => {
    await workspaceApi.clear()
    set({ items: [] })
  },

  reorder: async (itemIds: string[]) => {
    await workspaceApi.reorder(itemIds)
  },
}))
