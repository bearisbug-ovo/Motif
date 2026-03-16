import { create } from 'zustand'
import { systemApi, SystemStatus, SystemConfig } from '@/api/system'

interface SystemStore {
  status: SystemStatus | null
  config: SystemConfig | null
  loading: boolean
  fetchStatus: () => Promise<void>
  fetchConfig: () => Promise<void>
  updateConfig: (body: Partial<SystemConfig>) => Promise<SystemConfig & { restart_required?: boolean }>
}

export const useSystemStore = create<SystemStore>((set) => ({
  status: null,
  config: null,
  loading: false,

  fetchStatus: async () => {
    try {
      const status = await systemApi.getStatus()
      set({ status })
    } catch {}
  },

  fetchConfig: async () => {
    set({ loading: true })
    try {
      const config = await systemApi.getConfig()
      set({ config, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  updateConfig: async (body) => {
    const result = await systemApi.updateConfig(body)
    set({ config: result })
    return result
  },
}))
