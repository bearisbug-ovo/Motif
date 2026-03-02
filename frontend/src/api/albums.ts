import http from './http'

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
}

export type AlbumSortField = 'created_at' | 'avg_rating' | 'name'

export const albumsApi = {
  list: (personId?: string, sort?: AlbumSortField, filterRating?: string) =>
    http.get<Album[]>('/albums', { params: { person_id: personId, sort, filter_rating: filterRating } }).then(r => r.data),

  listByPerson: (personId: string, sort?: AlbumSortField) =>
    http.get<Album[]>(`/albums/by-person/${personId}`, { params: { sort } }).then(r => r.data),

  get: (id: string) =>
    http.get<Album>(`/albums/${id}`).then(r => r.data),

  create: (body: AlbumCreate) =>
    http.post<Album>('/albums', body).then(r => r.data),

  update: (id: string, body: AlbumUpdate) =>
    http.patch<Album>(`/albums/${id}`, body).then(r => r.data),

  delete: (id: string) =>
    http.delete(`/albums/${id}`),
}
