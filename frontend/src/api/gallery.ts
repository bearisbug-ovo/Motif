import http from './http'

export interface ImageRecord {
  id: number
  filepath: string
  character_id: number | null
  action_id: number | null
  prompt: string
  model: string
  seed: number
  faceswapped: boolean
  upscaled: boolean
  inpainted: boolean
  rating: number | null
  created_at: string
}

export const galleryApi = {
  list: (params?: {
    page?: number
    page_size?: number
    character_id?: number
    model?: string
    min_rating?: number
  }) => http.get<ImageRecord[]>('/images', { params }),
  get: (id: number) => http.get<ImageRecord>(`/images/${id}`),
  rate: (id: number, rating: number) =>
    http.patch<ImageRecord>(`/images/${id}/rating`, { rating }),
  remove: (id: number) => http.delete(`/images/${id}`),
}
