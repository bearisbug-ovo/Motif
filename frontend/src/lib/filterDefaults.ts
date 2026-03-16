// Per-page filter default settings, stored in localStorage
// Pattern mirrors zoomDefaults.ts

export type SortPageKey =
  | 'media-library'     // 人物库排序
  | 'person-albums'     // 人物主页·图集区排序
  | 'person-loose'      // 人物主页·未分类区排序
  | 'album-detail'      // 图集详情排序

type GlobalFilterKey = 'filterRating' | 'sourceType' | 'mediaType'

const SORT_FALLBACKS: Record<SortPageKey, string> = {
  'media-library':  'created_at:desc',
  'person-albums':  'created_at:desc',
  'person-loose':   'created_at:desc',
  'album-detail':   'sort_order:asc',
}

const GLOBAL_FALLBACKS: Record<GlobalFilterKey, string> = {
  filterRating: '',    // '' = 全部
  sourceType:   '',    // '' = 全部
  mediaType:    '',    // '' = 全部
}

export const SORT_PAGE_LABELS: Record<SortPageKey, string> = {
  'media-library': '人物库',
  'person-albums': '图集列表',
  'person-loose':  '未分类',
  'album-detail':  '图集详情',
}

export const SORT_OPTIONS_BY_PAGE: Record<SortPageKey, { value: string; label: string }[]> = {
  'media-library': [
    { value: 'created_at:desc', label: '最新创建' },
    { value: 'created_at:asc',  label: '最早创建' },
    { value: 'avg_rating:desc', label: '评分最高' },
    { value: 'avg_rating:asc',  label: '评分最低' },
    { value: 'name:asc',        label: '名称 A→Z' },
    { value: 'name:desc',       label: '名称 Z→A' },
  ],
  'person-albums': [
    { value: 'created_at:desc', label: '最新创建' },
    { value: 'created_at:asc',  label: '最早创建' },
    { value: 'avg_rating:desc', label: '评分最高' },
    { value: 'avg_rating:asc',  label: '评分最低' },
    { value: 'name:asc',        label: '名称 A→Z' },
    { value: 'name:desc',       label: '名称 Z→A' },
  ],
  'person-loose': [
    { value: 'created_at:desc', label: '最新添加' },
    { value: 'created_at:asc',  label: '最早添加' },
    { value: 'rating:desc',     label: '评分最高' },
    { value: 'rating:asc',      label: '评分最低' },
  ],
  'album-detail': [
    { value: 'sort_order:asc',  label: '默认顺序' },
    { value: 'sort_order:desc', label: '默认倒序' },
    { value: 'created_at:desc', label: '最新添加' },
    { value: 'created_at:asc',  label: '最早添加' },
    { value: 'rating:desc',     label: '评分最高' },
    { value: 'rating:asc',      label: '评分最低' },
  ],
}

/** Parse "field:dir" into [field, dir]. Handles legacy values without ":dir". */
export function parseSortValue(value: string): { field: string; dir: string } {
  const idx = value.lastIndexOf(':')
  if (idx > 0) {
    const dir = value.slice(idx + 1)
    if (dir === 'asc' || dir === 'desc') {
      return { field: value.slice(0, idx), dir }
    }
  }
  // Legacy fallback: bare field name
  return { field: value, dir: 'desc' }
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
  if (v) {
    // Migrate legacy values without ":dir" suffix
    if (!v.includes(':')) {
      const defaultDir = v === 'name' ? 'asc' : v === 'sort_order' ? 'asc' : 'desc'
      const migrated = `${v}:${defaultDir}`
      all[`sort-${page}`] = migrated
      saveAll(all)
      return migrated
    }
    return v
  }
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

export function getAllFilterDefaults(): { sorts: Record<SortPageKey, string>; filterRating: string; sourceType: string; mediaType: string } {
  const sorts = {} as Record<SortPageKey, string>
  for (const page of Object.keys(SORT_FALLBACKS) as SortPageKey[]) {
    sorts[page] = getSortDefault(page)
  }
  return {
    sorts,
    filterRating: getFilterDefault('filterRating'),
    sourceType: getFilterDefault('sourceType'),
    mediaType: getFilterDefault('mediaType'),
  }
}
