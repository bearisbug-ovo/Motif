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
  generation_params: Record<string, unknown> | null
  video_timestamp: number | null
  rating: number | null
  sort_order: number
  thumbnail_path: string | null
  width: number | null
  height: number | null
  file_size: number | null
  playback_position: number | null
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

export interface NavContext {
  album_id: string | null
  person_id: string | null
  local_items: MediaItem[]
  album_order: string[]
  person_order: string[]
}

export const mediaApi = {
  scanPaths: (paths: string[], recursive = true) =>
    http.post<{ results: { path: string; total: number; existing: number }[] }>('/media/scan', { paths, recursive }).then(r => r.data),

  importMedia: (body: ImportRequest) =>
    http.post<{ token: string; total: number; done?: number; skipped?: number; mode: string }>('/media/import', body).then(r => r.data),

  getImportStatus: (token: string) =>
    http.get<{ total: number; done: number; skipped: number; errors: string[]; status: string }>(`/media/import/${token}`).then(r => r.data),

  cancelImport: (token: string) =>
    http.post(`/media/import/${token}/cancel`).then(r => r.data),

  listByAlbum: (albumId: string, params?: { sort?: MediaSortField; sort_dir?: string; source_type?: string; filter_rating?: string; media_type?: string }) =>
    http.get<MediaItem[]>(`/media/album/${albumId}`, { params }).then(r => r.data),

  listLoose: (personId: string, params?: { sort?: MediaSortField; sort_dir?: string; filter_rating?: string; source_type?: string; media_type?: string }) =>
    http.get<MediaItem[]>(`/media/person/${personId}/loose`, { params }).then(r => r.data),

  listUncategorized: (params?: { sort?: MediaSortField; sort_dir?: string; source_type?: string; filter_rating?: string; media_type?: string }) =>
    http.get<MediaItem[]>('/media/uncategorized', { params }).then(r => r.data),

  countUncategorized: () =>
    http.get<{ count: number }>('/media/uncategorized/count').then(r => r.data),

  get: (id: string) =>
    http.get<MediaItem>(`/media/${id}`).then(r => r.data),

  update: (id: string, body: MediaUpdate) =>
    http.patch<MediaItem>(`/media/${id}`, body).then(r => r.data),

  batchUpdate: (body: BatchUpdate) =>
    http.patch<{ updated: string[] }>('/media/batch', body).then(r => r.data),

  saveProgress: (id: string, position: number) =>
    http.patch(`/media/${id}/progress`, null, { params: { position } }),

  getDescendantsCount: (id: string) =>
    http.get<{ count: number }>(`/media/${id}/descendants-count`).then(r => r.data),

  softDelete: (id: string, mode: 'cascade' | 'reparent' = 'cascade') =>
    http.delete(`/media/${id}`, { params: { mode } }),

  batchDelete: (ids: string[], mode: 'cascade' | 'reparent' = 'cascade') =>
    http.post<{ deleted: string[] }>('/media/batch-delete', { ids, mode }).then(r => r.data),

  batchDetach: (ids: string[]) =>
    http.post<{ detached: string[] }>('/media/batch-detach', { ids }).then(r => r.data),

  showInExplorer: (id: string) =>
    http.post(`/media/${id}/show-in-explorer`),

  captureScreenshot: (mediaId: string, blob: Blob, timestamp?: number) => {
    const form = new FormData()
    form.append('file', blob, 'screenshot.png')
    if (timestamp !== undefined) form.append('timestamp', String(timestamp))
    return http.post<MediaItem>(`/media/${mediaId}/screenshot`, form).then(r => r.data)
  },

  relocate: (id: string, newPath: string) =>
    http.patch<MediaItem>(`/media/${id}/relocate`, { new_path: newPath }).then(r => r.data),

  batchRelocate: (oldPrefix: string, newPrefix: string, scope?: string) =>
    http.post<{ updated: number }>('/media/batch-relocate', { old_prefix: oldPrefix, new_prefix: newPrefix, scope }).then(r => r.data),

  listFiles: (paths: string[], recursive = true) =>
    http.post<{ files: { path: string; name: string; media_type: string; existing: boolean }[] }>('/media/list-files', { paths, recursive }).then(r => r.data),

  explore: (params?: { person_id?: string; album_id?: string; filter_rating?: string; source_type?: string; limit?: number }) =>
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

  checkFiles: (ids: string[]) =>
    http.post<{ missing: string[] }>('/media/check-files', { ids }).then(r => r.data),

  detach: (id: string) =>
    http.post<MediaItem>(`/media/${id}/detach`).then(r => r.data),

  cropMedia: (mediaId: string, blob: Blob, options: {
    overwrite?: boolean; personId?: string | null
    albumId?: string | null; linkParent?: boolean
  } = {}) => {
    const form = new FormData()
    form.append('file', blob, 'cropped.png')
    form.append('overwrite', String(options.overwrite ?? false))
    if (options.personId) form.append('person_id', options.personId)
    if (options.albumId) form.append('album_id', options.albumId)
    form.append('link_parent', String(options.linkParent ?? true))
    return http.post<MediaItem>(`/media/${mediaId}/crop`, form).then(r => r.data)
  },

  uploadCrop: (mediaId: string, blob: Blob) => {
    const form = new FormData()
    form.append('file', blob, 'crop.png')
    return http.post<{ crop_path: string }>(`/media/${mediaId}/upload-crop`, form).then(r => r.data)
  },

  trimVideo: (mediaId: string, start: number, end: number, options: {
    precise?: boolean; personId?: string | null
    albumId?: string | null; linkParent?: boolean
  } = {}) =>
    http.post<MediaItem>(`/media/${mediaId}/trim`, {
      start, end,
      precise: options.precise ?? false,
      person_id: options.personId || undefined,
      album_id: options.albumId || undefined,
      link_parent: options.linkParent ?? true,
    }).then(r => r.data),

  getNavContext: (id: string, params?: { sort?: string; sort_dir?: string; filter_rating?: string; source_type?: string; media_type?: string }) =>
    http.get<NavContext>(`/media/${id}/nav-context`, { params }).then(r => r.data),

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
