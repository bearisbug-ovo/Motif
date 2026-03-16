import http from './http'

export interface Tag {
  id: string
  name: string
  color?: string | null
  sort_order: number
  person_count: number
  album_count: number
  created_at: string
}

export const tagsApi = {
  list: () =>
    http.get<Tag[]>('/tags').then(r => r.data),

  create: (name: string) =>
    http.post<Tag>('/tags', { name }).then(r => r.data),

  update: (id: string, data: { name?: string }) =>
    http.patch<Tag>(`/tags/${id}`, data).then(r => r.data),

  delete: (id: string) =>
    http.delete(`/tags/${id}`),

  merge: (id: string, targetId: string) =>
    http.post<Tag>(`/tags/${id}/merge`, { target_id: targetId }).then(r => r.data),

  reorder: (tagIds: string[]) =>
    http.patch<Tag[]>('/tags/reorder', { tag_ids: tagIds }).then(r => r.data),
}
