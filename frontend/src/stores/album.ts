import { create } from 'zustand'
import { albumsApi, Album, AlbumSortField } from '@/api/albums'

interface AlbumStore {
  albums: Album[]
  currentAlbum: Album | null
  loading: boolean
  fetchAlbumsByPerson: (personId: string, sort?: AlbumSortField) => Promise<void>
  fetchAlbum: (id: string) => Promise<void>
  createAlbum: (data: { name: string; person_id?: string }) => Promise<Album>
  updateAlbum: (id: string, data: { name?: string; cover_media_id?: string }) => Promise<void>
  deleteAlbum: (id: string) => Promise<void>
}

export const useAlbumStore = create<AlbumStore>((set) => ({
  albums: [],
  currentAlbum: null,
  loading: false,

  fetchAlbumsByPerson: async (personId, sort) => {
    set({ loading: true })
    try {
      const albums = await albumsApi.listByPerson(personId, sort)
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
}))
