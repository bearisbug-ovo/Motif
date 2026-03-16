import http from './http'

export interface WorkspaceMedia {
  id: string
  file_path: string
  media_type: string
  source_type: string
  person_id: string | null
  album_id: string | null
  rating: number | null
  width: number | null
  height: number | null
}

export interface WorkspaceItem {
  id: string
  media_id: string
  sort_order: number
  created_at: string
  media?: WorkspaceMedia
}

export const workspaceApi = {
  list: () =>
    http.get<WorkspaceItem[]>('/workspace').then(r => r.data),

  add: (media_id: string) =>
    http.post<WorkspaceItem>('/workspace', { media_id }).then(r => r.data),

  batchAdd: (media_ids: string[]) =>
    http.post<{ added: number; skipped: number; total: number }>('/workspace/batch', { media_ids }).then(r => r.data),

  remove: (item_id: string) =>
    http.delete(`/workspace/${item_id}`),

  clear: () =>
    http.delete<{ deleted: number }>('/workspace').then(r => r.data),

  reorder: (item_ids: string[]) =>
    http.patch('/workspace/reorder', { item_ids }).then(r => r.data),
}
