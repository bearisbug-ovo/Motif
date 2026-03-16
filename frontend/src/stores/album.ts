import { create } from 'zustand'
import { albumsApi, Album, AlbumSortField } from '@/api/albums'
import { getSortDefault, getFilterDefault, parseSortValue } from '@/lib/filterDefaults'

interface AlbumStore {
  albums: Album[]
  currentAlbum: Album | null
  loading: boolean
  sort: string
  filterRating: string | undefined
  filterTagIds: string[]
  fetchAlbumsByPerson: (personId: string) => Promise<void>
  fetchAlbum: (id: string) => Promise<void>
  createAlbum: (data: { name: string; person_id?: string }) => Promise<Album>
  updateAlbum: (id: string, data: { name?: string; cover_media_id?: string; person_id?: string; tag_ids?: string[] }) => Promise<void>
  deleteAlbum: (id: string, mode?: 'album_only' | 'album_and_media' | 'move_to_album', targetAlbumId?: string) => Promise<void>
  setSort: (sort: string) => void
  setFilterRating: (f: string | undefined) => void
  setFilterTagIds: (ids: string[]) => void
  resetFilters: () => void
}

export const useAlbumStore = create<AlbumStore>((set, get) => ({
  albums: [],
  currentAlbum: null,
  loading: false,
  sort: 'created_at:desc',
  filterRating: undefined,
  filterTagIds: [],

  fetchAlbumsByPerson: async (personId) => {
    set({ loading: true })
    try {
      const { sort, filterRating, filterTagIds } = get()
      const { field, dir } = parseSortValue(sort)
      const tagIds = filterTagIds.length > 0 ? filterTagIds.join(',') : undefined
      const albums = await albumsApi.listByPerson(personId, field as AlbumSortField, filterRating, dir, tagIds)
      set({ albums, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  fetchAlbum: async (id) => {
    const a = await albumsApi.get(id)
    set({ currentAlbum: a })
  },

  createAlbum: async (data) => {
    const a = await albumsApi.create(data)
    set((s) => ({ albums: [a, ...s.albums] }))
    return a
  },

  updateAlbum: async (id, data) => {
    const a = await albumsApi.update(id, data)
    set((s) => ({
      albums: s.albums.map((x) => (x.id === id ? a : x)),
      currentAlbum: s.currentAlbum?.id === id ? a : s.currentAlbum,
    }))
  },

  deleteAlbum: async (id, mode, targetAlbumId) => {
    await albumsApi.delete(id, mode, targetAlbumId)
    set((s) => ({ albums: s.albums.filter((x) => x.id !== id) }))
  },

  setSort: (sort) => set({ sort }),
  setFilterRating: (filterRating) => set({ filterRating }),
  setFilterTagIds: (filterTagIds) => set({ filterTagIds }),
  resetFilters: () => set({
    sort: getSortDefault('person-albums'),
    filterRating: getFilterDefault('filterRating') || undefined,
    filterTagIds: [],
  }),
}))
