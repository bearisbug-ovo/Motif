import http from './http'

export interface AlbumTag {
  id: string
  name: string
}

export interface Album {
  id: string
  person_id: string | null
  name: string
  cover_media_id: string | null
  cover_file_path: string | null
  is_generated_album: boolean
  avg_rating: number | null
  rated_count: number
  media_count: number
  tags?: AlbumTag[]
  created_at: string
  updated_at: string
}

export interface AlbumCreate {
  name: string
  person_id?: string
  is_generated_album?: boolean
}

export interface AlbumUpdate {
  name?: string
  cover_media_id?: string
  person_id?: string
  tag_ids?: string[]
}

export type AlbumSortField = 'created_at' | 'avg_rating' | 'name'

export const albumsApi = {
  list: (personId?: string, sort?: AlbumSortField, filterRating?: string, sortDir?: string, tagIds?: string) =>
    http.get<Album[]>('/albums', { params: { person_id: personId, sort, sort_dir: sortDir, filter_rating: filterRating, tag_ids: tagIds } }).then(r => r.data),

  listByPerson: (personId: string, sort?: AlbumSortField, filterRating?: string, sortDir?: string, tagIds?: string) =>
    http.get<Album[]>(`/albums/by-person/${personId}`, { params: { sort, sort_dir: sortDir, filter_rating: filterRating, tag_ids: tagIds } }).then(r => r.data),

  get: (id: string) =>
    http.get<Album>(`/albums/${id}`).then(r => r.data),

  create: (body: AlbumCreate) =>
    http.post<Album>('/albums', body).then(r => r.data),

  update: (id: string, body: AlbumUpdate) =>
    http.patch<Album>(`/albums/${id}`, body).then(r => r.data),

  delete: (id: string, mode?: 'album_only' | 'album_and_media' | 'move_to_album', targetAlbumId?: string) =>
    http.delete(`/albums/${id}`, { params: { mode: mode || 'album_only', target_album_id: targetAlbumId } }),

  cleanupEmpty: (personId?: string) =>
    http.post<{ deleted_count: number; deleted_albums: { id: string; name: string; person_id: string | null }[] }>('/albums/cleanup-empty', null, { params: personId ? { person_id: personId } : {} }).then(r => r.data),
}
