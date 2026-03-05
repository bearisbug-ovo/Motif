import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface FilterBarProps {
  sortField: string
  sortOptions: { value: string; label: string }[]
  onSortChange: (v: string) => void
  ratingFilter?: string
  onRatingFilterChange?: (v: string) => void
  sourceType?: string
  onSourceTypeChange?: (v: string) => void
}

export function FilterBar({
  sortField, sortOptions, onSortChange,
  ratingFilter, onRatingFilterChange,
  sourceType, onSourceTypeChange,
}: FilterBarProps) {
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
    </div>
  )
}
