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

  cancelImport: (token: string) =>
    http.post(`/media/import/${token}/cancel`).then(r => r.data),

  listByAlbum: (albumId: string, params?: { sort?: MediaSortField; source_type?: string; filter_rating?: string }) =>
    http.get<MediaItem[]>(`/media/album/${albumId}`, { params }).then(r => r.data),

  listLoose: (personId: string, params?: { sort?: MediaSortField; filter_rating?: string; source_type?: string }) =>
    http.get<MediaItem[]>(`/media/person/${personId}/loose`, { params }).then(r => r.data),

  get: (id: string) =>
    http.get<MediaItem>(`/media/${id}`).then(r => r.data),

  update: (id: string, body: MediaUpdate) =>
    http.patch<MediaItem>(`/media/${id}`, body).then(r => r.data),

  batchUpdate: (body: BatchUpdate) =>
    http.patch<{ updated: string[] }>('/media/batch', body).then(r => r.data),

  softDelete: (id: string) =>
    http.delete(`/media/${id}`),

  batchDelete: (ids: string[]) =>
    http.post<{ deleted: string[] }>('/media/batch-delete', { ids }).then(r => r.data),

  showInExplorer: (id: string) =>
    http.post(`/media/${id}/show-in-explorer`),

  captureScreenshot: (mediaId: string, blob: Blob) => {
    const form = new FormData()
    form.append('file', blob, 'screenshot.png')
    return http.post<MediaItem>(`/media/${mediaId}/screenshot`, form).then(r => r.data)
  },

  relocate: (id: string, newPath: string) =>
    http.patch<MediaItem>(`/media/${id}/relocate`, { new_path: newPath }).then(r => r.data),

  batchRelocate: (oldPrefix: string, newPrefix: string, scope?: string) =>
    http.post<{ updated: number }>('/media/batch-relocate', { old_prefix: oldPrefix, new_prefix: newPrefix, scope }).then(r => r.data),

  explore: (params?: { person_id?: string; album_id?: string; filter_rating?: string; source_type?: string }) =>
    http.get<MediaItem[]>('/media/explore', { params }).then(r => r.data),

  uploadFiles: (files: File[], personId?: string, albumId?: string) => {
    const form = new FormData()
    files.forEach(f => form.append('files', f))
    if (personId) form.append('person_id', personId)
    if (albumId) form.append('album_id', albumId)
    return http.post<{ imported: number; media_ids: string[] }>('/media/upload-files', form).then(r => r.data)
  },

  importClipboard: (blob: Blob, personId?: string, albumId?: string) => {
    const form = new FormData()
    form.append('file', blob, 'clipboard.png')
    if (personId) form.append('person_id', personId)
    if (albumId) form.append('album_id', albumId)
    return http.post<MediaItem>('/media/import-clipboard', form).then(r => r.data)
  },

  getByIds: (ids: string[]) =>
    http.post<MediaItem[]>('/media/by-ids', { ids }).then(r => r.data),

  detach: (id: string) =>
    http.post<MediaItem>(`/media/${id}/detach`).then(r => r.data),

  getTree: (id: string) =>
    http.get<{ root: Record<string, unknown> }>(`/media/${id}/tree`).then(r => r.data),

  thumbUrl: (path: string, size = 400) =>
    `/api/files/thumb?path=${encodeURIComponent(path)}&size=${size}`,

  /** Prefer thumbnail_path (e.g. screenshot cover) over file_path for thumbnails */
  itemThumbUrl: (item: MediaItem, size = 400) =>
    `/api/files/thumb?path=${encodeURIComponent(item.thumbnail_path || item.file_path)}&size=${size}`,

  serveUrl: (path: string) =>
    `/api/files/serve?path=${encodeURIComponent(path)}`,
}
