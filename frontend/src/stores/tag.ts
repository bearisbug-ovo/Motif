import { create } from 'zustand'
import { tagsApi, Tag } from '@/api/tags'

interface TagStore {
  tags: Tag[]
  loading: boolean
  fetchTags: () => Promise<void>
  createTag: (name: string) => Promise<Tag>
  updateTag: (id: string, data: { name?: string }) => Promise<void>
  deleteTag: (id: string) => Promise<void>
  mergeTag: (id: string, targetId: string) => Promise<void>
  reorderTags: (tagIds: string[]) => Promise<void>
}

export const useTagStore = create<TagStore>((set, get) => ({
  tags: [],
  loading: false,

  fetchTags: async () => {
    set({ loading: true })
    try {
      const tags = await tagsApi.list()
      set({ tags, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  createTag: async (name) => {
    const tag = await tagsApi.create(name)
    set((s) => ({ tags: [...s.tags, tag] }))
    return tag
  },

  updateTag: async (id, data) => {
    const tag = await tagsApi.update(id, data)
    set((s) => ({ tags: s.tags.map((t) => (t.id === id ? tag : t)) }))
  },

  deleteTag: async (id) => {
    await tagsApi.delete(id)
    set((s) => ({ tags: s.tags.filter((t) => t.id !== id) }))
  },

  mergeTag: async (id, targetId) => {
    const merged = await tagsApi.merge(id, targetId)
    set((s) => ({
      tags: s.tags.filter((t) => t.id !== id).map((t) => (t.id === targetId ? merged : t)),
    }))
  },

  reorderTags: async (tagIds) => {
    const tags = await tagsApi.reorder(tagIds)
    set({ tags })
  },
}))
