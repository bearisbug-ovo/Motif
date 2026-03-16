import { create } from 'zustand'
import { mediaApi, MediaItem, MediaSortField } from '@/api/media'
import { getSortDefault, getFilterDefault, SortPageKey, parseSortValue } from '@/lib/filterDefaults'
import { useLightboxStore, type LightboxContext } from '@/stores/lightbox'

export type { LightboxContext }

// Global callback for when a rating changes — pages can subscribe to refetch parent entities
let _onRatingChangeCallback: (() => void) | null = null
export function setOnRatingChange(cb: (() => void) | null) {
  _onRatingChangeCallback = cb
}

// Global callback for when media is deleted — pages can subscribe to refresh counts/local state
let _onDeleteCallback: ((ids: string[]) => void) | null = null
export function setOnDelete(cb: ((ids: string[]) => void) | null) {
  _onDeleteCallback = cb
}

interface MediaStore {
  items: MediaItem[]
  looseItems: MediaItem[]
  looseTotal: number  // unfiltered count — for section visibility
  loading: boolean
  sort: string
  filterRating: string | undefined
  sourceType: string | undefined
  mediaType: string | undefined
  lightboxIndex: number | null
  lightboxItems: MediaItem[]
  lightboxContext: LightboxContext

  // Multi-select
  multiSelectMode: boolean
  selectedIds: Set<string>

  fetchByAlbum: (albumId: string, overrides?: { sort?: string; filterRating?: string; sourceType?: string; mediaType?: string }) => Promise<void>
  fetchLoose: (personId: string, overrides?: { sort?: string; filterRating?: string; sourceType?: string; mediaType?: string }) => Promise<void>
  updateMedia: (id: string, data: { rating?: number | null; album_id?: string; person_id?: string }) => Promise<void>
  softDelete: (id: string, mode?: 'cascade' | 'reparent') => Promise<void>
  setSort: (sort: string) => void
  setFilterRating: (f: string | undefined) => void
  setSourceType: (t: string | undefined) => void
  setMediaType: (t: string | undefined) => void
  resetFilters: (pageKey: SortPageKey) => void
  openLightbox: (items: MediaItem[], index: number, context?: LightboxContext) => void
  closeLightbox: () => void
  lightboxNext: () => void
  lightboxPrev: () => void

  // Multi-select actions
  setMultiSelectMode: (on: boolean) => void
  toggleSelection: (id: string) => void
  selectAll: () => void
  clearSelection: () => void
  batchRate: (rating: number) => Promise<void>
  batchDelete: (mode?: 'cascade' | 'reparent') => Promise<void>
  batchMoveToAlbum: (albumId: string) => Promise<void>
  replaceItem: (updated: MediaItem) => void
}

export const useMediaStore = create<MediaStore>((set, get) => ({
  items: [],
  looseItems: [],
  looseTotal: 0,
  loading: false,
  sort: 'sort_order:asc',
  filterRating: undefined,
  sourceType: undefined,
  mediaType: undefined,
  lightboxIndex: null,
  lightboxItems: [],
  lightboxContext: {},

  multiSelectMode: false,
  selectedIds: new Set<string>(),

  fetchByAlbum: async (albumId, overrides?: { sort?: string; filterRating?: string; sourceType?: string; mediaType?: string }) => {
    set({ loading: true })
    try {
      const state = get()
      const sort = overrides?.sort ?? state.sort
      const filterRating = overrides?.filterRating !== undefined ? overrides.filterRating : state.filterRating
      const sourceType = overrides?.sourceType !== undefined ? overrides.sourceType : state.sourceType
      const mediaType = overrides?.mediaType !== undefined ? overrides.mediaType : state.mediaType
      const { field, dir } = parseSortValue(sort)
      const items = await mediaApi.listByAlbum(albumId, { sort: field as MediaSortField, sort_dir: dir, filter_rating: filterRating, source_type: sourceType, media_type: mediaType })
      set({ items, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  fetchLoose: async (personId, overrides?: { sort?: string; filterRating?: string; sourceType?: string; mediaType?: string }) => {
    set({ loading: true })
    try {
      const state = get()
      const sort = overrides?.sort ?? state.sort
      const filterRating = overrides?.filterRating !== undefined ? overrides.filterRating : state.filterRating
      const sourceType = overrides?.sourceType !== undefined ? overrides.sourceType : state.sourceType
      const mediaType = overrides?.mediaType !== undefined ? overrides.mediaType : state.mediaType
      const { field, dir } = parseSortValue(sort)
      const hasFilters = !!(sourceType || filterRating || mediaType)
      const [looseItems, unfilteredItems] = await Promise.all([
        mediaApi.listLoose(personId, { sort: field as MediaSortField, sort_dir: dir, filter_rating: filterRating, source_type: sourceType, media_type: mediaType }),
        hasFilters ? mediaApi.listLoose(personId, { sort: 'created_at', sort_dir: 'desc' }) : Promise.resolve(null),
      ])
      set({ looseItems, looseTotal: unfilteredItems !== null ? unfilteredItems.length : looseItems.length, loading: false })
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
    }))
    // Sync to lightbox store
    const lbState = useLightboxStore.getState()
    if (lbState.isOpen) {
      useLightboxStore.setState({
        localItems: lbState.localItems.map(x => x.id === id ? m : x),
        chainFlat: lbState.chainFlat.map(x => x.id === id ? m : x),
        currentItem: lbState.currentItem?.id === id ? m : lbState.currentItem,
      })
    }
    // Notify parent page to refetch album/person ratings
    if (data.rating !== undefined) _onRatingChangeCallback?.()
  },

  softDelete: async (id, mode = 'cascade') => {
    await mediaApi.softDelete(id, mode)
    // Update lightbox store
    const lbState = useLightboxStore.getState()
    if (lbState.isOpen) {
      const newLocalItems = lbState.localItems.filter(x => x.id !== id)
      const newChainFlat = lbState.chainFlat.filter(x => x.id !== id)
      let newLocalIndex = lbState.localIndex
      let newChainIndex = lbState.chainIndex
      let newCurrentItem = lbState.currentItem

      if (lbState.currentItem?.id === id) {
        // Current item was deleted
        if (newChainIndex >= 0) {
          // Was viewing a chain item
          if (newChainFlat.length > 0) {
            newChainIndex = Math.min(newChainIndex, newChainFlat.length - 1)
            newCurrentItem = newChainFlat[newChainIndex]
          } else {
            newChainIndex = -1
            newCurrentItem = newLocalItems[newLocalIndex] || null
          }
        } else {
          // Was viewing a local item
          if (newLocalItems.length === 0) {
            useLightboxStore.getState().close()
          } else {
            newLocalIndex = Math.min(newLocalIndex, newLocalItems.length - 1)
            newCurrentItem = newLocalItems[newLocalIndex]
          }
        }
      }

      if (newLocalItems.length > 0) {
        useLightboxStore.setState({
          localItems: newLocalItems,
          localIndex: newLocalIndex,
          chainFlat: newChainFlat,
          chainIndex: newChainIndex,
          currentItem: newCurrentItem,
          chainCache: new Map(),
        })
      }
    }

    set((s) => ({
      items: s.items.filter((x) => x.id !== id),
      looseItems: s.looseItems.filter((x) => x.id !== id),
    }))
    _onDeleteCallback?.([id])
  },

  setSort: (sort) => set({ sort }),
  setFilterRating: (filterRating) => set({ filterRating }),
  setSourceType: (sourceType) => set({ sourceType }),
  setMediaType: (mediaType) => set({ mediaType }),
  resetFilters: (pageKey) => set({
    sort: getSortDefault(pageKey),
    filterRating: getFilterDefault('filterRating') || undefined,
    sourceType: getFilterDefault('sourceType') || undefined,
    mediaType: getFilterDefault('mediaType') || undefined,
  }),

  openLightbox: (items, index, ctx = {}) => {
    // Inject current sort/filter state so LightBox preserves ordering across albums
    const { sort, filterRating, sourceType, mediaType } = get()
    const { field, dir } = parseSortValue(sort)
    const enrichedCtx: LightboxContext = {
      ...ctx,
      sort: field,
      sortDir: dir,
      filterRating,
      sourceType,
      mediaType,
    }
    useLightboxStore.getState().open(items, index, enrichedCtx)
    // Sync to legacy fields for backward compat
    set({ lightboxItems: items, lightboxIndex: index, lightboxContext: enrichedCtx })
  },
  closeLightbox: () => {
    useLightboxStore.getState().close()
    set({ lightboxIndex: null, lightboxItems: [], lightboxContext: {} })
  },

  lightboxNext: () => {
    useLightboxStore.getState().navigateH(1)
  },

  lightboxPrev: () => {
    useLightboxStore.getState().navigateH(-1)
  },

  // Multi-select
  setMultiSelectMode: (on) => set({ multiSelectMode: on, selectedIds: new Set() }),

  toggleSelection: (id) => set((s) => {
    const next = new Set(s.selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return { selectedIds: next }
  }),

  selectAll: () => set((s) => {
    const allIds = [...s.items, ...s.looseItems].map((m) => m.id)
    return { selectedIds: new Set(allIds) }
  }),

  clearSelection: () => set({ selectedIds: new Set() }),

  batchRate: async (rating) => {
    const { selectedIds } = get()
    const ids = [...selectedIds]
    if (ids.length === 0) return
    await mediaApi.batchUpdate({ ids, rating })
    // Refresh items in store
    set((s) => ({
      items: s.items.map((m) => ids.includes(m.id) ? { ...m, rating } : m),
      looseItems: s.looseItems.map((m) => ids.includes(m.id) ? { ...m, rating } : m),
    }))
    _onRatingChangeCallback?.()
  },

  batchDelete: async (mode = 'cascade') => {
    const { selectedIds } = get()
    const ids = [...selectedIds]
    if (ids.length === 0) return
    await mediaApi.batchDelete(ids, mode)
    set((s) => ({
      items: s.items.filter((m) => !ids.includes(m.id)),
      looseItems: s.looseItems.filter((m) => !ids.includes(m.id)),
      selectedIds: new Set(),
      multiSelectMode: false,
    }))
    _onDeleteCallback?.(ids)
  },

  batchMoveToAlbum: async (albumId) => {
    const { selectedIds } = get()
    const ids = [...selectedIds]
    if (ids.length === 0) return
    await mediaApi.batchUpdate({ ids, album_id: albumId })
    set({ selectedIds: new Set(), multiSelectMode: false })
  },

  replaceItem: (updated) => {
    set((s) => ({
      items: s.items.map((x) => (x.id === updated.id ? updated : x)),
      looseItems: s.looseItems.map((x) => (x.id === updated.id ? updated : x)),
    }))
    // Sync to lightbox
    const lbState = useLightboxStore.getState()
    if (lbState.isOpen) {
      useLightboxStore.setState({
        localItems: lbState.localItems.map(x => x.id === updated.id ? updated : x),
        chainFlat: lbState.chainFlat.map(x => x.id === updated.id ? updated : x),
        currentItem: lbState.currentItem?.id === updated.id ? updated : lbState.currentItem,
      })
    }
  },
}))
