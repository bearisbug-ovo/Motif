import { useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Tag } from '@/api/tags'

interface FilterBarProps {
  sortField: string
  sortOptions: { value: string; label: string }[]
  onSortChange: (v: string) => void
  ratingFilter?: string
  onRatingFilterChange?: (v: string) => void
  sourceType?: string
  onSourceTypeChange?: (v: string) => void
  mediaType?: string
  onMediaTypeChange?: (v: string) => void
  tags?: Tag[]
  selectedTagIds?: string[]
  onTagChange?: (ids: string[]) => void
}

const MAX_VISIBLE_TAGS = 5

export function FilterBar({
  sortField, sortOptions, onSortChange,
  ratingFilter, onRatingFilterChange,
  sourceType, onSourceTypeChange,
  mediaType, onMediaTypeChange,
  tags, selectedTagIds, onTagChange,
}: FilterBarProps) {
  const [tagExpanded, setTagExpanded] = useState(false)

  const toggleTag = (id: string) => {
    if (!onTagChange || !selectedTagIds) return
    if (selectedTagIds.includes(id)) {
      onTagChange(selectedTagIds.filter((t) => t !== id))
    } else {
      onTagChange([...selectedTagIds, id])
    }
  }

  const visibleTags = tags && tags.length > 0
  const displayTags = visibleTags
    ? tagExpanded ? tags : tags.slice(0, MAX_VISIBLE_TAGS)
    : []
  const hiddenCount = visibleTags && !tagExpanded ? Math.max(0, tags.length - MAX_VISIBLE_TAGS) : 0

  return (
    <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
      <Select value={sortField} onValueChange={onSortChange}>
        <SelectTrigger className="w-[5.5rem] sm:w-32 h-7 sm:h-8 text-xs">
          <SelectValue placeholder="排序" />
        </SelectTrigger>
        <SelectContent>
          {sortOptions.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {onRatingFilterChange && (
        <Select value={ratingFilter || 'all'} onValueChange={(v) => onRatingFilterChange(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-20 sm:w-28 h-7 sm:h-8 text-xs">
            <SelectValue placeholder="评分" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部评分</SelectItem>
            <SelectItem value="gte:5">5星</SelectItem>
            <SelectItem value="gte:4">4星+</SelectItem>
            <SelectItem value="gte:3">3星+</SelectItem>
            <SelectItem value="lte:2">2星以下</SelectItem>
          </SelectContent>
        </Select>
      )}

      {onSourceTypeChange && (
        <Select value={sourceType || 'all'} onValueChange={(v) => onSourceTypeChange(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-20 sm:w-28 h-7 sm:h-8 text-xs">
            <SelectValue placeholder="来源" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部来源</SelectItem>
            <SelectItem value="local">本地图</SelectItem>
            <SelectItem value="generated">AI生成</SelectItem>
            <SelectItem value="screenshot">截图</SelectItem>
          </SelectContent>
        </Select>
      )}

      {onMediaTypeChange && (
        <Select value={mediaType || 'all'} onValueChange={(v) => onMediaTypeChange(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-20 sm:w-28 h-7 sm:h-8 text-xs">
            <SelectValue placeholder="类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            <SelectItem value="image">图片</SelectItem>
            <SelectItem value="video">视频</SelectItem>
          </SelectContent>
        </Select>
      )}

      {visibleTags && onTagChange && selectedTagIds && (
        <>
          <div className="w-px h-5 bg-border mx-0.5 hidden sm:block" />
          <button
            className={`h-7 sm:h-8 px-2 sm:px-3 rounded-md text-xs font-medium transition-colors ${
              selectedTagIds.length === 0
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-accent text-muted-foreground'
            }`}
            onClick={() => onTagChange([])}
          >
            全部
          </button>
          {displayTags.map((t) => (
            <button
              key={t.id}
              className={`h-7 sm:h-8 px-2 sm:px-3 rounded-md text-xs font-medium transition-colors ${
                selectedTagIds.includes(t.id)
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted hover:bg-accent text-muted-foreground'
              }`}
              onClick={() => toggleTag(t.id)}
            >
              {t.name}
            </button>
          ))}
          {hiddenCount > 0 && (
            <button
              className="h-7 sm:h-8 px-2 rounded-md text-xs text-muted-foreground hover:bg-accent"
              onClick={() => setTagExpanded(true)}
            >
              +{hiddenCount}...
            </button>
          )}
        </>
      )}
    </div>
  )
}
