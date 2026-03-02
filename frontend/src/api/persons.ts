import http from './http'

export interface Person {
  id: string
  name: string
  cover_media_id: string | null
  cover_file_path: string | null
  avg_rating: number | null
  rated_count: number
  media_count: number
  album_count: number
  created_at: string
  updated_at: string
}

export interface PersonCreate {
  name: string
}

export interface PersonUpdate {
  name?: string
  cover_media_id?: string
}

export type PersonSortField = 'created_at' | 'avg_rating' | 'name'
export type RatingFilter = string // e.g. "gte:4"

export const personsApi = {
  list: (sort?: PersonSortField, filterRating?: RatingFilter) =>
    http.get<Person[]>('/persons', { params: { sort, filter_rating: filterRating } }).then(r => r.data),

  get: (id: string) =>
    http.get<Person>(`/persons/${id}`).then(r => r.data),

  create: (body: PersonCreate) =>
    http.post<Person>('/persons', body).then(r => r.data),

  update: (id: string, body: PersonUpdate) =>
    http.patch<Person>(`/persons/${id}`, body).then(r => r.data),

  delete: (id: string, mode: 'person_only' | 'person_and_albums' | 'all' = 'person_only') =>
    http.delete(`/persons/${id}`, { params: { mode } }),
}
