import { create } from 'zustand'
import { albumsApi, Album, AlbumSortField } from '@/api/albums'
import { getSortDefault, getFilterDefault } from '@/lib/filterDefaults'

interface AlbumStore {
  albums: Album[]
  currentAlbum: Album | null
  loading: boolean
  sort: AlbumSortField
  filterRating: string | undefined
  fetchAlbumsByPerson: (personId: string) => Promise<void>
  fetchAlbum: (id: string) => Promise<void>
  createAlbum: (data: { name: string; person_id?: string }) => Promise<Album>
  updateAlbum: (id: string, data: { name?: string; cover_media_id?: string }) => Promise<void>
  deleteAlbum: (id: string) => Promise<void>
  setSort: (sort: AlbumSortField) => void
  setFilterRating: (f: string | undefined) => void
  resetFilters: () => void
}

export const useAlbumStore = create<AlbumStore>((set, get) => ({
  albums: [],
  currentAlbum: null,
  loading: false,
  sort: 'created_at' as AlbumSortField,
  filterRating: undefined,

  fetchAlbumsByPerson: async (personId) => {
    set({ loading: true })
    try {
      const { sort, filterRating } = get()
      const albums = await albumsApi.listByPerson(personId, sort, filterRating)
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

  deleteAlbum: async (id) => {
    await albumsApi.delete(id)
    set((s) => ({ albums: s.albums.filter((x) => x.id !== id) }))
  },

  setSort: (sort) => set({ sort }),
  setFilterRating: (filterRating) => set({ filterRating }),
  resetFilters: () => set({
    sort: getSortDefault('person-albums') as AlbumSortField,
    filterRating: getFilterDefault('filterRating') || undefined,
  }),
}))
