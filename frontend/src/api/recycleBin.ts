import http from './http'

export interface RecycleBinItem {
  id: string
  album_id: string | null
  person_id: string | null
  file_path: string
  media_type: string
  source_type: string
  rating: number | null
  thumbnail_path: string | null
  is_deleted: boolean
  deleted_at: string | null
  created_at: string
  person_name: string | null
  album_name: string | null
  days_until_auto_delete: number | null
}

export interface RecycleBinResponse {
  total: number
  page: number
  page_size: number
  items: RecycleBinItem[]
}

export const recycleBinApi = {
  list: (page = 1, pageSize = 50, sort?: string) =>
    http.get<RecycleBinResponse>('/recycle-bin', { params: { page, page_size: pageSize, sort } }).then(r => r.data),

  restore: (id: string) =>
    http.post(`/recycle-bin/${id}/restore`).then(r => r.data),

  permanentDelete: (id: string) =>
    http.delete(`/recycle-bin/${id}`),

  empty: () =>
    http.delete('/recycle-bin'),
}
