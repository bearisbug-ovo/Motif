import { useState, useMemo } from 'react'
import { MapPin, ChevronDown } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MediaDestinationPicker } from './MediaDestinationPicker'
import { usePersonStore } from '@/stores/person'
import { useAlbumStore } from '@/stores/album'

export interface ResultDestinationProps {
  personId: string | null
  albumId: string | null
  onLocationChange: (personId: string | null, albumId: string | null) => void

  /** Single source — checkbox mode */
  linkParent?: boolean
  onLinkParentChange?: (v: boolean) => void

  /** Multiple sources — dropdown mode */
  linkParentOptions?: Array<{ value: string; label: string }>
  linkParentValue?: string
  onLinkParentSelect?: (value: string) => void

  /** Batch mode: show "跟随原图" as default */
  batchMode?: boolean
}

export function ResultDestination({
  personId, albumId, onLocationChange,
  linkParent, onLinkParentChange,
  linkParentOptions, linkParentValue, onLinkParentSelect,
  batchMode,
}: ResultDestinationProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const { persons } = usePersonStore()
  const { albums } = useAlbumStore()

  const locationLabel = useMemo(() => {
    if (batchMode && !personId && !albumId) return '跟随原图'
    const personName = personId
      ? persons.find(p => p.id === personId)?.name || '未知人物'
      : '未分类'
    if (albumId) {
      const albumName = albums.find(a => a.id === albumId)?.name || '未知图集'
      return `${personName} / ${albumName}`
    }
    return `${personName} / 散图`
  }, [personId, albumId, persons, albums, batchMode])

  const hasLinkCheckbox = onLinkParentChange !== undefined
  const hasLinkDropdown = linkParentOptions && linkParentOptions.length > 0 && onLinkParentSelect

  return (
    <>
      <div className="space-y-2 py-2">
        {/* Location row */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1">
            <MapPin className="w-3 h-3" />
            保存到
          </span>
          <button
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-muted hover:bg-accent transition-colors min-w-0 max-w-[260px]"
            onClick={() => setPickerOpen(true)}
          >
            <span className="truncate">{locationLabel}</span>
            <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
          </button>
        </div>

        {/* Link parent — checkbox mode */}
        {hasLinkCheckbox && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={linkParent ?? false}
              onChange={e => onLinkParentChange!(e.target.checked)}
              className="rounded border-input"
            />
            关联原图（生成链）
          </label>
        )}

        {/* Link parent — dropdown mode */}
        {hasLinkDropdown && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground shrink-0">关联原图</span>
            <Select value={linkParentValue ?? ''} onValueChange={v => onLinkParentSelect!(v)}>
              <SelectTrigger className="h-7 text-xs flex-1 max-w-[200px]">
                <SelectValue placeholder="不关联" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">不关联</SelectItem>
                {linkParentOptions!.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <MediaDestinationPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        personId={personId}
        albumId={albumId}
        onConfirm={onLocationChange}
      />
    </>
  )
}
