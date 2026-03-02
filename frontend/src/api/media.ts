import http from './http'

export interface MediaItem {
  id: string
  album_id: string | null
  person_id: string | null
  file_path: string
  media_type: 'image' | 'video'
  source_type: 'local' | 'generated' | 'screenshot'
  parent_media_id: string | null
  workflow_type: string | null
  upscale_status: string | null
  rating: number | null
  sort_order: number
  thumbnail_path: string | null
  width: number | null
  height: number | null
  file_size: number | null
  is_deleted: boolean
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export interface ImportRequest {
  paths: string[]
  person_id?: string
  album_id?: string
  recursive?: boolean
}

export interface MediaUpdate {
  rating?: number
  album_id?: string
  person_id?: string
}

export interface BatchUpdate {
  ids: string[]
  rating?: number
  album_id?: string
  person_id?: string
}

export type MediaSortField = 'sort_order' | 'created_at' | 'rating'

export const mediaApi = {
  importMedia: (body: ImportRequest) =>
    http.post<{ token: string; total: number; done?: number; mode: string }>('/media/import', body).then(r => r.data),

  getImportStatus: (token: string) =>
    http.get<{ total: number; done: number; errors: string[]; status: string }>(`/media/import/${token}`).then(r => r.data),

  listByAlbum: (albumId: string, params?: { sort?: MediaSortField; source_type?: string; filter_rating?: string }) =>
    http.get<MediaItem[]>(`/media/album/${albumId}`, { params }).then(r => r.data),

  listLoose: (personId: string, params?: { sort?: MediaSortField; filter_rating?: string }) =>
    http.get<MediaItem[]>(`/media/person/${personId}/loose`, { params }).then(r => r.data),

  get: (id: string) =>
    http.get<MediaItem>(`/media/${id}`).then(r => r.data),

  update: (id: string, body: MediaUpdate) =>
    http.patch<MediaItem>(`/media/${id}`, body).then(r => r.data),

  batchUpdate: (body: BatchUpdate) =>
    http.patch<{ updated: string[] }>('/media/batch', body).then(r => r.data),

  softDelete: (id: string) =>
    http.delete(`/media/${id}`),

  getTree: (id: string) =>
    http.get<{ root: Record<string, unknown> }>(`/media/${id}/tree`).then(r => r.data),

  thumbUrl: (path: string, size = 400) =>
    `/api/files/thumb?path=${encodeURIComponent(path)}&size=${size}`,

  serveUrl: (path: string) =>
    `/api/files/serve?path=${encodeURIComponent(path)}`,
}
