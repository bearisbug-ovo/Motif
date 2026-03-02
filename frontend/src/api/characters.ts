import http from './http'

export interface Character {
  id: number
  name: string
  source_folder: string | null
  reference_photos: string[]
  face_crop_nobg: string | null
  created_at: string
}

export interface FolderScanResult {
  folder_name: string
  folder_path: string
  photo_count: number
  already_imported: boolean
}

export const characterApi = {
  list: () => http.get<Character[]>('/characters'),
  get: (id: number) => http.get<Character>(`/characters/${id}`),
  update: (id: number, data: { name?: string }) =>
    http.patch<Character>(`/characters/${id}`, data),
  remove: (id: number) => http.delete(`/characters/${id}`),

  // Folder scan & import
  scanFolder: (path: string) =>
    http.post<FolderScanResult[]>('/characters/scan', { path }),
  importFolders: (items: { folder_path: string; name: string }[]) =>
    http.post<Character[]>('/characters/import', { items }, { timeout: 30000 }),
}
