import { create } from 'zustand'
import { mediaApi, MediaItem, MediaSortField } from '@/api/media'

interface LightboxContext {
  albumId?: string
  personId?: string
  onCoverSet?: () => void
}

// Global callback for when a rating changes — pages can subscribe to refetch parent entities
let _onRatingChangeCallback: (() => void) | null = null
export function setOnRatingChange(cb: (() => void) | null) {
  _onRatingChangeCallback = cb
}

interface MediaStore {
  items: MediaItem[]
  looseItems: MediaItem[]
  loading: boolean
  sort: MediaSortField
  filterRating: string | undefined
  sourceType: string | undefined
  lightboxIndex: number | null
  lightboxItems: MediaItem[]
  lightboxContext: LightboxContext

  fetchByAlbum: (albumId: string) => Promise<void>
  fetchLoose: (personId: string) => Promise<void>
  updateMedia: (id: string, data: { rating?: number | null; album_id?: string; person_id?: string }) => Promise<void>
  softDelete: (id: string) => Promise<void>
  setSort: (sort: MediaSortField) => void
  setFilterRating: (f: string | undefined) => void
  setSourceType: (t: string | undefined) => void
  openLightbox: (items: MediaItem[], index: number, context?: LightboxContext) => void
  closeLightbox: () => void
  lightboxNext: () => void
  lightboxPrev: () => void
}

export const useMediaStore = create<MediaStore>((set, get) => ({
  items: [],
  looseItems: [],
  loading: false,
  sort: 'sort_order',
  filterRating: undefined,
  sourceType: undefined,
  lightboxIndex: null,
  lightboxItems: [],
  lightboxContext: {},

  fetchByAlbum: async (albumId) => {
    set({ loading: true })
    try {
      const { sort, filterRating, sourceType } = get()
      const items = await mediaApi.listByAlbum(albumId, { sort, filter_rating: filterRating, source_type: sourceType })
      set({ items, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  fetchLoose: async (personId) => {
    set({ loading: true })
    try {
      const { sort, filterRating } = get()
      const looseItems = await mediaApi.listLoose(personId, { sort, filter_rating: filterRating })
      set({ looseItems, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  updateMedia: async (id, data) => {
    // Convert null rating to 0 (backend interprets 0 as "clear rating")
    const payload = { ...data, rating: data.rating === null ? 0 : data.rating }
    const m = await mediaApi.update(id, payload)
    set((s) => ({
      items: s.items.map((x) => (x.id === id ? m : x)),
      looseItems: s.looseItems.map((x) => (x.id === id ? m : x)),
      lightboxItems: s.lightboxItems.map((x) => (x.id === id ? m : x)),
    }))
    // Notify parent page to refetch album/person ratings
    if (data.rating !== undefined) _onRatingChangeCallback?.()
  },

  softDelete: async (id) => {
    await mediaApi.softDelete(id)
    set((s) => {
      const newLightboxItems = s.lightboxItems.filter((x) => x.id !== id)
      let newLightboxIndex = s.lightboxIndex
      if (newLightboxIndex !== null) {
        if (newLightboxItems.length === 0) {
          newLightboxIndex = null
        } else if (newLightboxIndex >= newLightboxItems.length) {
          newLightboxIndex = newLightboxItems.length - 1
        }
      }
      return {
        items: s.items.filter((x) => x.id !== id),
        looseItems: s.looseItems.filter((x) => x.id !== id),
        lightboxItems: newLightboxItems,
        lightboxIndex: newLightboxIndex,
      }
    })
  },

  setSort: (sort) => set({ sort }),
  setFilterRating: (filterRating) => set({ filterRating }),
  setSourceType: (sourceType) => set({ sourceType }),

  openLightbox: (lightboxItems, lightboxIndex, lightboxContext = {}) => set({ lightboxItems, lightboxIndex, lightboxContext }),
  closeLightbox: () => set({ lightboxIndex: null, lightboxItems: [], lightboxContext: {} }),

  lightboxNext: () => {
    const { lightboxIndex, lightboxItems } = get()
    if (lightboxIndex === null) return
    set({ lightboxIndex: Math.min(lightboxIndex + 1, lightboxItems.length - 1) })
  },

  lightboxPrev: () => {
    const { lightboxIndex } = get()
    if (lightboxIndex === null) return
    set({ lightboxIndex: Math.max(lightboxIndex - 1, 0) })
  },
}))
