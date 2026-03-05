// Per-page filter default settings, stored in localStorage
// Pattern mirrors zoomDefaults.ts

export type SortPageKey =
  | 'media-library'     // 人物库排序
  | 'person-albums'     // 人物主页·图集区排序
  | 'person-loose'      // 人物主页·散图区排序
  | 'album-detail'      // 图集详情排序

type GlobalFilterKey = 'filterRating' | 'sourceType'

const SORT_FALLBACKS: Record<SortPageKey, string> = {
  'media-library':  'created_at',
  'person-albums':  'created_at',
  'person-loose':   'created_at',
  'album-detail':   'sort_order',
}

const GLOBAL_FALLBACKS: Record<GlobalFilterKey, string> = {
  filterRating: '',    // '' = 全部
  sourceType:   '',    // '' = 全部
}

export const SORT_PAGE_LABELS: Record<SortPageKey, string> = {
  'media-library': '人物库',
  'person-albums': '图集列表',
  'person-loose':  '散图',
  'album-detail':  '图集详情',
}

export const SORT_OPTIONS_BY_PAGE: Record<SortPageKey, { value: string; label: string }[]> = {
  'media-library': [
    { value: 'created_at', label: '最新创建' },
    { value: 'avg_rating', label: '评分最高' },
    { value: 'name', label: '名称 A-Z' },
  ],
  'person-albums': [
    { value: 'created_at', label: '最新创建' },
    { value: 'avg_rating', label: '评分最高' },
    { value: 'name', label: '名称 A-Z' },
  ],
  'person-loose': [
    { value: 'created_at', label: '最新添加' },
    { value: 'rating', label: '评分最高' },
  ],
  'album-detail': [
    { value: 'sort_order', label: '默认顺序' },
    { value: 'created_at', label: '最新添加' },
    { value: 'rating', label: '评分最高' },
  ],
}

const STORAGE_KEY = 'motif-filter-defaults'

function loadAll(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return {}
}

function saveAll(data: Record<string, string>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)) } catch {}
}

export function getSortDefault(page: SortPageKey): string {
  const all = loadAll()
  const v = all[`sort-${page}`]
  if (v) return v
  return SORT_FALLBACKS[page]
}

export function setSortDefault(page: SortPageKey, value: string) {
  const all = loadAll()
  all[`sort-${page}`] = value
  saveAll(all)
}

export function getFilterDefault(key: GlobalFilterKey): string {
  const all = loadAll()
  const v = all[key]
  if (typeof v === 'string') return v
  return GLOBAL_FALLBACKS[key]
}

export function setFilterDefault(key: GlobalFilterKey, value: string) {
  const all = loadAll()
  all[key] = value
  saveAll(all)
}

export function getAllFilterDefaults(): { sorts: Record<SortPageKey, string>; filterRating: string; sourceType: string } {
  const sorts = {} as Record<SortPageKey, string>
  for (const page of Object.keys(SORT_FALLBACKS) as SortPageKey[]) {
    sorts[page] = getSortDefault(page)
  }
  return {
    sorts,
    filterRating: getFilterDefault('filterRating'),
    sourceType: getFilterDefault('sourceType'),
  }
}
