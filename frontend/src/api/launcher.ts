import http from './http'

export interface LauncherStatus {
  backend: {
    running: boolean
    uptime: string
    uptime_seconds: number
    version: string
    port: number
    pid: number
  }
  comfyui: {
    connected: boolean
    url: string
    managed: boolean
  }
  clients: {
    ip: string
    user_agent: string
    last_seen: string
    last_seen_ago: string
    request_count: number
  }[]
  client_count: number
  errors: {
    last_1h: number
    last_24h: number
    recent: {
      time: string
      time_ago: string
      status: number
      method: string
      path: string
      detail: string
    }[]
  }
  disk: {
    total_gb: number
    used_gb: number
    free_gb: number
  }
}

export const launcherApi = {
  getStatus: () =>
    http.get<LauncherStatus>('/launcher/status').then(r => r.data),

  startComfyUI: () =>
    http.post<{ status: string; pid?: number; detail?: string }>('/launcher/comfyui/start').then(r => r.data),

  stopComfyUI: () =>
    http.post<{ status: string }>('/launcher/comfyui/stop').then(r => r.data),

  restartBackend: () =>
    http.post<{ status: string }>('/launcher/restart-backend').then(r => r.data),

  getLogs: (lines = 50) =>
    http.get<Record<string, string[]>>('/launcher/logs', { params: { lines } }).then(r => r.data),
}
