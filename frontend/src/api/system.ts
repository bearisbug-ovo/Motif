import http from './http'

export interface SystemStatus {
  comfyui: { connected: boolean; url: string }
  disk: { total_gb: number; used_gb: number; free_gb: number }
}

export interface SystemConfig {
  appdata_dir: string
  comfyui_url: string
  thumbnail_size: number
  recycle_bin_days: number
}

export const systemApi = {
  getStatus: () =>
    http.get<SystemStatus>('/system/status').then(r => r.data),

  getConfig: () =>
    http.get<SystemConfig>('/system/config').then(r => r.data),

  updateConfig: (body: Partial<SystemConfig>) =>
    http.put<SystemConfig>('/system/config', body).then(r => r.data),

  pickFolder: () =>
    http.get<{ path: string }>('/files/pick-folder').then(r => r.data),

  pickFiles: () =>
    http.get<{ paths: string[] }>('/files/pick-files').then(r => r.data),

  listSubfolders: (path: string) =>
    http.get<{ subfolders: { name: string; path: string; media_count: number }[] }>('/files/list-subfolders', { params: { path } }).then(r => r.data),
}
