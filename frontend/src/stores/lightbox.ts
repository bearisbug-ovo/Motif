import { create } from 'zustand'
import { mediaApi, MediaItem, MediaSortField, NavContext } from '@/api/media'
import { albumsApi } from '@/api/albums'
import { toast } from '@/hooks/use-toast'

export interface LightboxContext {
  albumId?: string
  personId?: string
  onCoverSet?: () => void
  exploreMode?: boolean
  onReshuffle?: () => void
  taskResultsMode?: boolean
  /** Preserve the sort/filter state from the page that opened the lightbox */
  sort?: string
  sortDir?: string
  filterRating?: string
  sourceType?: string
  mediaType?: string
}

interface ChainTreeNode {
  id: string
  children: ChainTreeNode[]
  [key: string]: unknown
}

interface LightboxStore {
  // Basic state
  isOpen: boolean
  currentItem: MediaItem | null
  context: LightboxContext

  // Horizontal axis (local image navigation)
  localItems: MediaItem[]
  localIndex: number
  albumOrder: string[]
  currentAlbumIdx: number
  personOrder: string[]
  currentPersonIdx: number
  flatMode: boolean

  // Vertical axis (generation chain navigation)
  chainTree: ChainTreeNode | null
  chainFlat: MediaItem[]
  chainIndex: number // -1 = on local root, >=0 = in chainFlat
  chainLoading: boolean
  chainCache: Map<string, { tree: ChainTreeNode; flat: MediaItem[] }>

  // Actions
  open: (items: MediaItem[], index: number, ctx?: LightboxContext) => void
  close: () => void
  navigateH: (dir: 1 | -1) => void
  navigateV: (dir: 1 | -1) => void
  jumpTo: (id: string) => void
  setCurrentItem: (item: MediaItem) => void
  loadChainForCurrent: () => Promise<void>
  invalidateChainCache: (rootId?: string) => void
}

function flattenTree(node: ChainTreeNode): MediaItem[] {
  const result: MediaItem[] = []
  if (!node || !node.id) return result
  // Skip the root (it's the local image itself), only collect descendants
  for (const child of node.children || []) {
    result.push(child as unknown as MediaItem)
    result.push(...flattenTreeRecursive(child))
  }
  return result
}

function flattenTreeRecursive(node: ChainTreeNode): MediaItem[] {
  const result: MediaItem[] = []
  for (const child of node.children || []) {
    result.push(child as unknown as MediaItem)
    result.push(...flattenTreeRecursive(child))
  }
  return result
}

function findLocalRoot(item: MediaItem, items: MediaItem[]): MediaItem {
  let current = item
  let depth = 0
  while (current.parent_media_id && depth < 10) {
    const parent = items.find(m => m.id === current.parent_media_id)
    if (!parent) break
    current = parent
    depth++
  }
  return current
}

/** Navigate to a local item at the given index, reset chain state, load new chain. */
function goToLocalItem(set: Function, get: () => LightboxStore, idx: number, items?: MediaItem[]) {
  const localItems = items || get().localItems
  if (idx < 0 || idx >= localItems.length) return
  // Don't clear chainTree/chainFlat yet — keep indicator visible to avoid layout jitter.
  // loadChainForCurrent will atomically replace them when the new chain arrives.
  set({
    ...(items ? { localItems: items } : {}),
    localIndex: idx,
    currentItem: localItems[idx],
    chainIndex: -1,
    chainLoading: true,
  })
  get().loadChainForCurrent()
}

export const useLightboxStore = create<LightboxStore>((set, get) => ({
  isOpen: false,
  currentItem: null,
  context: {},

  localItems: [],
  localIndex: 0,
  albumOrder: [],
  currentAlbumIdx: -1,
  personOrder: [],
  currentPersonIdx: -1,
  flatMode: false,

  chainTree: null,
  chainFlat: [],
  chainIndex: -1,
  chainLoading: false,
  chainCache: new Map(),

  open: (items, index, ctx = {}) => {
    const item = items[index]
    if (!item) return

    const hasContext = !!(ctx.albumId || ctx.personId)

    if (!hasContext || ctx.exploreMode) {
      // Flat mode
      set({
        isOpen: true,
        currentItem: item,
        context: ctx,
        localItems: items,
        localIndex: index,
        flatMode: true,
        albumOrder: [],
        currentAlbumIdx: -1,
        personOrder: [],
        currentPersonIdx: -1,
        chainTree: null,
        chainFlat: [],
        chainIndex: -1,
        chainLoading: false,
      })
      get().loadChainForCurrent()
      return
    }

    // Temporarily use filtered local items from provided items
    const localOnly = items.filter(i => i.source_type === 'local')
    const localIdx = localOnly.findIndex(i => i.id === item.id)

    set({
      isOpen: true,
      currentItem: item,
      context: ctx,
      localItems: localOnly.length > 0 ? localOnly : items,
      localIndex: localIdx >= 0 ? localIdx : 0,
      flatMode: false,
      albumOrder: [],
      currentAlbumIdx: -1,
      personOrder: [],
      currentPersonIdx: -1,
      chainTree: null,
      chainFlat: [],
      chainIndex: item.source_type === 'local' ? -1 : 0,
      chainLoading: false,
    })

    // Fetch nav-context with sort/filter from the opening page
    const navParams: Record<string, string | undefined> = {}
    if (ctx.sort) navParams.sort = ctx.sort
    if (ctx.sortDir) navParams.sort_dir = ctx.sortDir
    if (ctx.filterRating) navParams.filter_rating = ctx.filterRating
    if (ctx.sourceType) navParams.source_type = ctx.sourceType
    if (ctx.mediaType) navParams.media_type = ctx.mediaType
    mediaApi.getNavContext(item.id, Object.keys(navParams).length > 0 ? navParams : undefined).then((nav: NavContext) => {
      const state = get()
      if (!state.isOpen) return

      const navLocalItems = nav.local_items.length > 0 ? nav.local_items : localOnly
      let navLocalIdx = navLocalItems.findIndex(i => i.id === item.id)

      if (navLocalIdx < 0 && item.source_type !== 'local') {
        const root = findLocalRoot(item, items)
        navLocalIdx = navLocalItems.findIndex(i => i.id === root.id)
      }

      const albumIdx = nav.album_order.indexOf(nav.album_id || '')
      const personIdx = nav.person_order.indexOf(nav.person_id || '')

      set({
        localItems: navLocalItems,
        localIndex: Math.max(0, navLocalIdx),
        albumOrder: nav.album_order,
        currentAlbumIdx: albumIdx,
        personOrder: nav.person_order,
        currentPersonIdx: personIdx,
      })
    }).catch(() => {})

    get().loadChainForCurrent()
  },

  close: () => {
    set({
      isOpen: false,
      currentItem: null,
      context: {},
      localItems: [],
      localIndex: 0,
      flatMode: false,
      chainTree: null,
      chainFlat: [],
      chainIndex: -1,
      chainLoading: false,
      chainCache: new Map(),
      albumOrder: [],
      currentAlbumIdx: -1,
      personOrder: [],
      currentPersonIdx: -1,
    })
  },

  navigateH: (dir) => {
    const state = get()
    if (!state.isOpen) return

    // If currently on a generated image, return to local root first, then move
    if (state.chainIndex >= 0) {
      // Reset to root, then move in direction
      set({ chainIndex: -1 })
    }

    const newIdx = state.localIndex + dir

    // Within current scope
    if (newIdx >= 0 && newIdx < state.localItems.length) {
      goToLocalItem(set, get, newIdx)
      return
    }

    // Flat mode: hard stop
    if (state.flatMode) {
      toast({ title: dir > 0 ? '已到最后一张' : '已到第一张' })
      return
    }

    // Build sort/filter params from context for cross-album API calls
    const crossParams: { sort?: MediaSortField; sort_dir?: string; source_type?: string; filter_rating?: string; media_type?: string } = { source_type: 'local' }
    if (state.context.sort) crossParams.sort = state.context.sort as MediaSortField
    if (state.context.sortDir) crossParams.sort_dir = state.context.sortDir
    if (state.context.filterRating) crossParams.filter_rating = state.context.filterRating
    if (state.context.mediaType) crossParams.media_type = state.context.mediaType

    // --- Cross-album ---
    const tryNextAlbum = (albumIdx: number): void => {
      if (albumIdx < 0 || albumIdx >= state.albumOrder.length) {
        // Album exhausted, try cross-person
        tryNextPerson(state.currentPersonIdx + dir)
        return
      }

      const nextAlbumId = state.albumOrder[albumIdx]
      // Skip the current album (shouldn't happen, but guard)
      if (nextAlbumId === state.context.albumId && albumIdx === state.currentAlbumIdx) {
        tryNextPerson(state.currentPersonIdx + dir)
        return
      }

      set({ chainLoading: true })
      mediaApi.listByAlbum(nextAlbumId, crossParams).then((items) => {
        if (!get().isOpen) return
        if (items.length === 0) {
          // Empty album, skip to next one
          tryNextAlbum(albumIdx + dir)
          return
        }
        const idx = dir > 0 ? 0 : items.length - 1
        set({
          localItems: items,
          localIndex: idx,
          currentAlbumIdx: albumIdx,
          currentItem: items[idx],
          chainTree: null,
          chainFlat: [],
          chainIndex: -1,
          chainLoading: false,
          context: { ...get().context, albumId: nextAlbumId },
        })
        get().loadChainForCurrent()
      }).catch(() => set({ chainLoading: false }))
    }

    const tryNextPerson = (personIdx: number): void => {
      if (personIdx < 0 || personIdx >= state.personOrder.length) {
        toast({ title: dir > 0 ? '已到最后一张' : '已到第一张' })
        set({ chainLoading: false })
        return
      }

      const nextPersonId = state.personOrder[personIdx]
      set({ chainLoading: true })

      // Fetch albums for the next person
      albumsApi.listByPerson(nextPersonId).then((albums) => {
        if (!get().isOpen) return
        if (albums.length === 0) {
          // No albums — try loose items
          mediaApi.listLoose(nextPersonId, crossParams).then((items) => {
            if (!get().isOpen) return
            if (items.length === 0) {
              // Empty person, skip to next
              tryNextPerson(personIdx + dir)
              return
            }
            const idx = dir > 0 ? 0 : items.length - 1
            const newAlbumOrder: string[] = []
            set({
              localItems: items,
              localIndex: idx,
              currentPersonIdx: personIdx,
              currentAlbumIdx: -1,
              albumOrder: newAlbumOrder,
              currentItem: items[idx],
              chainTree: null,
              chainFlat: [],
              chainIndex: -1,
              chainLoading: false,
              context: { ...get().context, personId: nextPersonId, albumId: undefined },
            })
            get().loadChainForCurrent()
          }).catch(() => set({ chainLoading: false }))
          return
        }

        // Has albums — pick first/last album of this person
        const newAlbumOrder = albums.map(a => a.id)
        const targetAlbumIdx = dir > 0 ? 0 : newAlbumOrder.length - 1
        const targetAlbumId = newAlbumOrder[targetAlbumIdx]

        mediaApi.listByAlbum(targetAlbumId, crossParams).then((items) => {
          if (!get().isOpen) return
          if (items.length === 0) {
            // Empty first album, could recurse but keep simple
            toast({ title: '下一人物的图集为空' })
            set({ chainLoading: false })
            return
          }
          const idx = dir > 0 ? 0 : items.length - 1
          set({
            localItems: items,
            localIndex: idx,
            currentPersonIdx: personIdx,
            currentAlbumIdx: targetAlbumIdx,
            albumOrder: newAlbumOrder,
            currentItem: items[idx],
            chainTree: null,
            chainFlat: [],
            chainIndex: -1,
            chainLoading: false,
            context: { ...get().context, personId: nextPersonId, albumId: targetAlbumId },
          })
          get().loadChainForCurrent()
        }).catch(() => set({ chainLoading: false }))
      }).catch(() => set({ chainLoading: false }))
    }

    // Start cross-album/person navigation
    tryNextAlbum(state.currentAlbumIdx + dir)
  },

  navigateV: (dir) => {
    const state = get()
    if (!state.isOpen) return

    if (dir === 1) {
      // Down: deeper into chain
      if (state.chainIndex === -1) {
        if (state.chainFlat.length > 0) {
          set({ chainIndex: 0, currentItem: state.chainFlat[0] })
        } else {
          // No chain, go to next local image
          get().navigateH(1)
        }
      } else if (state.chainIndex < state.chainFlat.length - 1) {
        const newIdx = state.chainIndex + 1
        set({ chainIndex: newIdx, currentItem: state.chainFlat[newIdx] })
      } else {
        // Chain exhausted, go to next local image
        const nextLocalIdx = state.localIndex + 1
        if (nextLocalIdx < state.localItems.length) {
          goToLocalItem(set, get, nextLocalIdx)
        } else {
          // Try cross-album via navigateH
          set({ chainIndex: -1 })
          get().navigateH(1)
        }
      }
    } else {
      // Up: back toward root
      if (state.chainIndex === -1) {
        // Already at root — go to previous local image
        const prevLocalIdx = state.localIndex - 1
        if (prevLocalIdx >= 0) {
          goToLocalItem(set, get, prevLocalIdx)
        } else if (!state.flatMode) {
          get().navigateH(-1)
        }
        return
      }
      if (state.chainIndex === 0) {
        set({ chainIndex: -1, currentItem: state.localItems[state.localIndex] })
      } else {
        const newIdx = state.chainIndex - 1
        set({ chainIndex: newIdx, currentItem: state.chainFlat[newIdx] })
      }
    }
  },

  jumpTo: (id) => {
    const state = get()
    if (!state.isOpen) return

    // Check local items first
    const localIdx = state.localItems.findIndex(m => m.id === id)
    if (localIdx >= 0) {
      goToLocalItem(set, get, localIdx)
      return
    }

    // Check chain items
    const chainIdx = state.chainFlat.findIndex(m => m.id === id)
    if (chainIdx >= 0) {
      set({ chainIndex: chainIdx, currentItem: state.chainFlat[chainIdx] })
      return
    }

    // Fetch the item
    mediaApi.get(id).then(item => {
      if (!get().isOpen) return
      set({ currentItem: item })
    }).catch(() => {})
  },

  setCurrentItem: (item) => set({ currentItem: item }),

  invalidateChainCache: (rootId?: string) => {
    if (rootId) {
      const cache = new Map(get().chainCache)
      cache.delete(rootId)
      set({ chainCache: cache })
    } else {
      set({ chainCache: new Map() })
    }
    // If lightbox is open, reload the current chain
    const state = get()
    if (state.isOpen && state.localItems.length > 0) {
      get().loadChainForCurrent()
    }
  },

  loadChainForCurrent: async () => {
    const state = get()
    // Skip chain loading in task results mode
    if (state.context.taskResultsMode) {
      set({ chainTree: null, chainFlat: [], chainLoading: false })
      return
    }
    const item = state.localItems[state.localIndex]
    if (!item) return

    // Check cache
    const cached = state.chainCache.get(item.id)
    if (cached) {
      set({ chainTree: cached.tree, chainFlat: cached.flat, chainLoading: false })
      return
    }

    set({ chainLoading: true })
    try {
      const result = await mediaApi.getTree(item.id)
      const tree = result.root as unknown as ChainTreeNode
      const flat = flattenTree(tree)
      const cache = new Map(get().chainCache)
      cache.set(item.id, { tree, flat })
      if (get().localItems[get().localIndex]?.id === item.id) {
        set({ chainTree: tree, chainFlat: flat, chainCache: cache, chainLoading: false })
      }
    } catch {
      set({ chainTree: null, chainFlat: [], chainLoading: false })
    }
  },
}))
