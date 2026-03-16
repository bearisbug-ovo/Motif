// Per-page zoom default settings, stored in localStorage
// Keys: `zoom-default-{pageKey}-{platform}`
// Values: column count (grid mode) or row height px (row mode)

export type ZoomPageKey =
  | 'media-library'
  | 'person-home'
  | 'album-grid'
  | 'album-row'
  | 'workspace'
  | 'recycle-bin'

export type ZoomPlatform = 'desktop' | 'mobile'

const FALLBACKS: Record<ZoomPageKey, Record<ZoomPlatform, number>> = {
  'media-library': { desktop: 5, mobile: 3 },
  'person-home':   { desktop: 5, mobile: 3 },
  'album-grid':    { desktop: 5, mobile: 3 },
  'album-row':     { desktop: 200, mobile: 120 },
  'workspace':     { desktop: 5, mobile: 3 },
  'recycle-bin':    { desktop: 5, mobile: 3 },
}

export const PAGE_LABELS: Record<ZoomPageKey, string> = {
  'media-library': '人物库',
  'person-home':   '人物主页',
  'album-grid':    '图集详情 (网格)',
  'album-row':     '图集详情 (行高px)',
  'workspace':     '工作区',
  'recycle-bin':    '回收站',
}

const STORAGE_KEY = 'motif-zoom-defaults'

function loadAll(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return {}
}

function saveAll(data: Record<string, number>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)) } catch {}
}

function key(page: ZoomPageKey, platform: ZoomPlatform) {
  return `${page}-${platform}`
}

export function getZoomDefault(page: ZoomPageKey, platform: ZoomPlatform): number {
  const all = loadAll()
  const v = all[key(page, platform)]
  if (typeof v === 'number' && v > 0) return v
  return FALLBACKS[page][platform]
}

export function setZoomDefault(page: ZoomPageKey, platform: ZoomPlatform, value: number) {
  const all = loadAll()
  all[key(page, platform)] = value
  saveAll(all)
}

export function getAllZoomDefaults(): Record<string, number> {
  const all = loadAll()
  const result: Record<string, number> = {}
  for (const page of Object.keys(FALLBACKS) as ZoomPageKey[]) {
    for (const platform of ['desktop', 'mobile'] as ZoomPlatform[]) {
      const k = key(page, platform)
      result[k] = all[k] ?? FALLBACKS[page][platform]
    }
  }
  return result
}
