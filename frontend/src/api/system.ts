import http from './http'

export interface SystemStatus {
  comfyui: {
    connected: boolean
    url: string
    reconnect_failures: number
    max_retries_reached: boolean
  }
  disk: { total_gb: number; used_gb: number; free_gb: number }
}

export interface SystemConfig {
  appdata_dir: string
  comfyui_url: string
  comfyui_launch_cmd: string
  thumbnail_size: number
  recycle_bin_days: number
  task_timeout_minutes: number
  fastapi_port: number
  platform_cookies: Record<string, string>
}

export const systemApi = {
  getStatus: () =>
    http.get<SystemStatus>('/system/status').then(r => r.data),

  getConfig: () =>
    http.get<SystemConfig>('/system/config').then(r => r.data),

  updateConfig: (body: Partial<SystemConfig>) =>
    http.put<SystemConfig & { restart_required?: boolean }>('/system/config', body).then(r => r.data),

  pickFolder: () =>
    http.get<{ path: string }>('/files/pick-folder', { timeout: 0 }).then(r => r.data),

  pickFiles: () =>
    http.get<{ paths: string[] }>('/files/pick-files', { timeout: 0 }).then(r => r.data),

  listSubfolders: (path: string) =>
    http.get<{ subfolders: { name: string; path: string; media_count: number }[] }>('/files/list-subfolders', { params: { path } }).then(r => r.data),
}
