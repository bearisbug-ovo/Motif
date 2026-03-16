import { useState, useEffect } from 'react'
import { ArrowUpDown, ExternalLink } from 'lucide-react'
import { mediaApi, MediaItem } from '@/api/media'
import { useLightboxStore } from '@/stores/lightbox'
import { useMediaStore } from '@/stores/media'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

export function SourceButtons() {
  const { currentItem: item, close, setCurrentItem } = useLightboxStore()
  const { openLightbox } = useMediaStore()

  const [sourceView, setSourceView] = useState<{ resultItem: MediaItem; sourceItem: MediaItem } | null>(null)
  const [loading, setLoading] = useState(false)

  const isViewingSource = sourceView !== null && item?.id === sourceView.sourceItem.id

  // Reset when item changes externally (navigation)
  useEffect(() => {
    if (sourceView && item && item.id !== sourceView.sourceItem.id && item.id !== sourceView.resultItem.id) {
      setSourceView(null)
    }
  }, [item?.id])

  if (!item) return null

  const hasParent = !isViewingSource && item.parent_media_id
  if (!hasParent && !isViewingSource) return null

  const handleToggleSource = async () => {
    if (isViewingSource && sourceView) {
      setCurrentItem(sourceView.resultItem)
      setSourceView(null)
    } else if (item.parent_media_id) {
      setLoading(true)
      try {
        const parent = await mediaApi.get(item.parent_media_id)
        setSourceView({ resultItem: item, sourceItem: parent })
        setCurrentItem(parent)
      } catch {
        toast({ title: '无法加载源图', variant: 'destructive' })
      } finally {
        setLoading(false)
      }
    }
  }

  const handleViewInAlbum = async () => {
    let source: MediaItem
    if (isViewingSource && sourceView) {
      source = sourceView.sourceItem
    } else if (item.parent_media_id) {
      try {
        source = await mediaApi.get(item.parent_media_id)
      } catch {
        toast({ title: '无法加载源图信息', variant: 'destructive' })
        return
      }
    } else {
      return
    }
    close()
    setTimeout(() => {
      openLightbox(
        [source], 0,
        {
          albumId: source.album_id || undefined,
          personId: source.person_id || undefined,
        }
      )
    }, 50)
  }

  return (
    <div
      className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={handleToggleSource}
        disabled={loading}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium backdrop-blur-sm transition-colors',
          isViewingSource
            ? 'bg-blue-500/80 text-white hover:bg-blue-500'
            : 'bg-white/15 text-white/80 hover:bg-white/25 hover:text-white'
        )}
      >
        <ArrowUpDown className="w-3.5 h-3.5" />
        {isViewingSource ? '返回结果' : '查看源图'}
      </button>

      <button
        onClick={handleViewInAlbum}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-white/15 text-white/80 hover:bg-white/25 hover:text-white backdrop-blur-sm transition-colors"
      >
        <ExternalLink className="w-3.5 h-3.5" />
        在图集中查看
      </button>
    </div>
  )
}
