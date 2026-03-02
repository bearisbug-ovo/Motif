import http from './http'
import { MediaItem } from './media'

export interface RecycleBinResponse {
  total: number
  page: number
  page_size: number
  items: MediaItem[]
}

export const recycleBinApi = {
  list: (page = 1, pageSize = 50) =>
    http.get<RecycleBinResponse>('/recycle-bin', { params: { page, page_size: pageSize } }).then(r => r.data),

  restore: (id: string) =>
    http.post(`/recycle-bin/${id}/restore`).then(r => r.data),

  permanentDelete: (id: string) =>
    http.delete(`/recycle-bin/${id}`),

  empty: () =>
    http.delete('/recycle-bin'),
}
