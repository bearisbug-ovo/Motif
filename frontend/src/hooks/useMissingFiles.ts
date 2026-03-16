import { useState, useEffect, useRef } from 'react'
import { mediaApi, MediaItem } from '@/api/media'

/**
 * Given a list of media items, check which files are missing on disk.
 * Returns a Set of missing media IDs.
 * Checks are batched and debounced to avoid spamming the API.
 */
export function useMissingFiles(items: MediaItem[]): Set<string> {
  const [missingIds, setMissingIds] = useState<Set<string>>(new Set())
  const prevIdsRef = useRef<string>('')

  useEffect(() => {
    // Only local/screenshot source types can be missing (generated files are in appdata)
    const idsToCheck = items.filter(m => m.source_type === 'local').map(m => m.id)
    const key = idsToCheck.join(',')
    if (key === prevIdsRef.current || idsToCheck.length === 0) return
    prevIdsRef.current = key

    mediaApi.checkFiles(idsToCheck)
      .then(({ missing }) => setMissingIds(new Set(missing)))
      .catch(() => {})
  }, [items])

  return missingIds
}
