import { create } from 'zustand'
import { tasksApi, TaskItem, TaskStats, TaskProgress, QueueConfig } from '@/api/tasks'
import { useLightboxStore } from '@/stores/lightbox'

interface TaskStore {
  tasks: TaskItem[]
  stats: TaskStats | null
  progress: TaskProgress | null
  queueConfig: QueueConfig | null
  loading: boolean
  pollingId: number | null

  fetchTasks: (status?: string) => Promise<void>
  fetchStats: () => Promise<void>
  fetchQueueConfig: () => Promise<void>
  startPolling: () => void
  stopPolling: () => void
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  stats: null,
  progress: null,
  queueConfig: null,
  loading: false,
  pollingId: null,

  fetchTasks: async (status?: string) => {
    set({ loading: true })
    try {
      const tasks = await tasksApi.list(status)
      set({ tasks, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  fetchStats: async () => {
    try {
      const prev = get().stats
      const stats = await tasksApi.getStats()
      set({ stats, progress: stats.progress })
      // When new tasks complete, invalidate lightbox chain cache so generation chains refresh
      if (prev && stats.completed_since_last_view > prev.completed_since_last_view) {
        useLightboxStore.getState().invalidateChainCache()
      }
    } catch {}
  },

  fetchQueueConfig: async () => {
    try {
      const queueConfig = await tasksApi.getQueueConfig()
      set({ queueConfig })
    } catch {}
  },

  startPolling: () => {
    const { pollingId } = get()
    if (pollingId) return // already polling

    // Fetch immediately
    get().fetchStats()

    const id = window.setInterval(() => {
      get().fetchStats()
    }, 3000)
    set({ pollingId: id })
  },

  stopPolling: () => {
    const { pollingId } = get()
    if (pollingId) {
      clearInterval(pollingId)
      set({ pollingId: null })
    }
  },
}))
