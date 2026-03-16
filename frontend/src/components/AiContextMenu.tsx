import { Sparkles, ZoomIn, Repeat, Paintbrush, Image, Wand2, ScanSearch } from 'lucide-react'
import { MenuItem, SubMenuItem } from './ContextMenuPortal'
import { MediaItem } from '@/api/media'

/** AI submenu for a single media item (image only) */
export function AiMediaSubMenu({ item, onAction }: {
  item: MediaItem
  onAction: (category: string) => void
}) {
  if (item.media_type !== 'image') return null
  return (
    <SubMenuItem icon={<Sparkles className="w-3.5 h-3.5" />} label="AI 功能">
      <MenuItem icon={<ZoomIn className="w-3.5 h-3.5" />} label="高清放大" onClick={() => onAction('upscale')} />
      <MenuItem icon={<Repeat className="w-3.5 h-3.5" />} label="换脸" onClick={() => onAction('face_swap')} />
      <MenuItem icon={<Paintbrush className="w-3.5 h-3.5" />} label="局部重绘" onClick={() => onAction('inpaint')} />
      <MenuItem icon={<Image className="w-3.5 h-3.5" />} label="图生图" onClick={() => onAction('image_to_image')} />
      <MenuItem icon={<Wand2 className="w-3.5 h-3.5" />} label="文生图" onClick={() => onAction('text_to_image')} />
      <MenuItem icon={<ScanSearch className="w-3.5 h-3.5" />} label="预处理" onClick={() => onAction('preprocess')} />
    </SubMenuItem>
  )
}

/** AI batch submenu for album/multi-select (batchable categories only) */
export function AiBatchSubMenu({ onBatchAi }: {
  onBatchAi: (category: string) => void
}) {
  return (
    <SubMenuItem icon={<Sparkles className="w-3.5 h-3.5" />} label="AI 批量">
      <MenuItem icon={<ZoomIn className="w-3.5 h-3.5" />} label="批量高清放大" onClick={() => onBatchAi('upscale')} />
      <MenuItem icon={<Repeat className="w-3.5 h-3.5" />} label="批量换脸" onClick={() => onBatchAi('face_swap')} />
      <MenuItem icon={<Image className="w-3.5 h-3.5" />} label="批量图生图" onClick={() => onBatchAi('image_to_image')} />
      <MenuItem icon={<ScanSearch className="w-3.5 h-3.5" />} label="批量预处理" onClick={() => onBatchAi('preprocess')} />
    </SubMenuItem>
  )
}
