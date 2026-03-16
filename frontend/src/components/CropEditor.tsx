import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X, Check, RotateCw, Undo2 } from 'lucide-react'
import ReactCrop, { type Crop, type PixelCrop, centerCrop, makeAspectCrop } from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import { MediaItem, mediaApi } from '@/api/media'
import { Button } from '@/components/ui/button'
import { ResultDestination } from './ResultDestination'

type AspectPreset = { label: string; value: number | undefined }

const ASPECT_PRESETS: AspectPreset[] = [
  { label: '自由', value: undefined },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '16:9', value: 16 / 9 },
  { label: '3:4', value: 3 / 4 },
  { label: '9:16', value: 9 / 16 },
]

export interface CropSaveOptions {
  overwrite: boolean
  personId?: string | null
  albumId?: string | null
  linkParent?: boolean
}

interface CropEditorProps {
  open: boolean
  onClose: () => void
  media: MediaItem | null
  /** 'save' = permanent crop, 'temp' = for workflow input */
  mode: 'save' | 'temp'
  onComplete: (blob: Blob, options: CropSaveOptions) => void
}

export function CropEditor({ open, onClose, media, mode, onComplete }: CropEditorProps) {
  const [crop, setCrop] = useState<Crop>()
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>()
  const [aspect, setAspect] = useState<number | undefined>(undefined)
  const [rotation, setRotation] = useState(0)
  const [overwrite, setOverwrite] = useState(false)
  const [imgSrc, setImgSrc] = useState('')
  const imgRef = useRef<HTMLImageElement>(null)

  // Destination state
  const [targetPersonId, setTargetPersonId] = useState<string | null>(null)
  const [targetAlbumId, setTargetAlbumId] = useState<string | null>(null)
  const [linkParent, setLinkParent] = useState(false)

  useEffect(() => {
    if (open && media) {
      setImgSrc(mediaApi.serveUrl(media.file_path))
      setCrop(undefined)
      setCompletedCrop(undefined)
      setAspect(undefined)
      setRotation(0)
      setOverwrite(false)
      setTargetPersonId(media.person_id ?? null)
      setTargetAlbumId(media.album_id ?? null)
      setLinkParent(false)
    }
  }, [open, media])

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      if (e.key === 'Enter') { e.preventDefault(); handleConfirm() }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, completedCrop, rotation])

  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget
    // Initial crop: centered 80%
    const c = centerCrop(
      makeAspectCrop({ unit: '%', width: 80 }, w / h, w, h),
      w,
      h,
    )
    setCrop(c)
  }, [])

  const handleAspectChange = useCallback((preset: AspectPreset) => {
    setAspect(preset.value)
    if (preset.value && imgRef.current) {
      const { naturalWidth: w, naturalHeight: h } = imgRef.current
      const c = centerCrop(
        makeAspectCrop({ unit: '%', width: 60 }, preset.value, w, h),
        w,
        h,
      )
      setCrop(c)
    }
  }, [])

  const handleRotate = useCallback(() => {
    setRotation(r => (r + 90) % 360)
  }, [])

  const handleReset = useCallback(() => {
    setCrop(undefined)
    setCompletedCrop(undefined)
    setAspect(undefined)
    setRotation(0)
  }, [])

  const handleConfirm = useCallback(async () => {
    const img = imgRef.current
    if (!img || !completedCrop) return

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const scaleX = img.naturalWidth / img.width
    const scaleY = img.naturalHeight / img.height

    const cropX = completedCrop.x * scaleX
    const cropY = completedCrop.y * scaleY
    const cropW = completedCrop.width * scaleX
    const cropH = completedCrop.height * scaleY

    if (rotation === 0) {
      canvas.width = cropW
      canvas.height = cropH
      ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH)
    } else {
      // Handle rotation
      const rad = (rotation * Math.PI) / 180
      const sin = Math.abs(Math.sin(rad))
      const cos = Math.abs(Math.cos(rad))

      // First draw rotated full image to an offscreen canvas
      const fullW = img.naturalWidth
      const fullH = img.naturalHeight
      const rotW = fullW * cos + fullH * sin
      const rotH = fullW * sin + fullH * cos

      const offCanvas = document.createElement('canvas')
      offCanvas.width = rotW
      offCanvas.height = rotH
      const offCtx = offCanvas.getContext('2d')!
      offCtx.translate(rotW / 2, rotH / 2)
      offCtx.rotate(rad)
      offCtx.drawImage(img, -fullW / 2, -fullH / 2)

      // Now crop from rotated image
      // Scale crop coords based on displayed vs natural rotated size
      const displayRatio = img.width / (rotation % 180 === 0 ? fullW : rotW)
      const sx = completedCrop.x / displayRatio
      const sy = completedCrop.y / displayRatio
      const sw = completedCrop.width / displayRatio
      const sh = completedCrop.height / displayRatio

      canvas.width = sw
      canvas.height = sh
      ctx.drawImage(offCanvas, sx, sy, sw, sh, 0, 0, sw, sh)
    }

    canvas.toBlob(
      (blob) => {
        if (blob) {
          if (mode === 'save') {
            onComplete(blob, {
              overwrite,
              personId: overwrite ? undefined : targetPersonId,
              albumId: overwrite ? undefined : targetAlbumId,
              linkParent: overwrite ? undefined : linkParent,
            })
          } else {
            onComplete(blob, { overwrite: false })
          }
        }
      },
      'image/png',
      1,
    )
  }, [completedCrop, rotation, onComplete, mode, overwrite, targetPersonId, targetAlbumId, linkParent])

  if (!open || !media) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[60] bg-black/95 flex flex-col select-none"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Top toolbar */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/80 border-b border-white/10">
        <div className="flex items-center gap-2">
          <span className="text-white/70 text-sm mr-2">宽高比:</span>
          {ASPECT_PRESETS.map((preset) => (
            <button
              key={preset.label}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                aspect === preset.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-white/10 text-white/70 hover:bg-white/20'
              }`}
              onClick={() => handleAspectChange(preset)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="text-white/70 hover:text-white" onClick={handleRotate}>
            <RotateCw className="w-4 h-4 mr-1" />
            旋转
          </Button>
          <Button variant="ghost" size="sm" className="text-white/70 hover:text-white" onClick={handleReset}>
            <Undo2 className="w-4 h-4 mr-1" />
            重置
          </Button>
        </div>
      </div>

      {/* Crop area */}
      <div className="flex-1 flex items-center justify-center overflow-hidden p-4 min-h-0">
        <div style={{ transform: `rotate(${rotation}deg)`, transition: 'transform 0.3s' }}>
          <ReactCrop
            crop={crop}
            onChange={(c) => setCrop(c)}
            onComplete={(c) => setCompletedCrop(c)}
            aspect={aspect}
            className="max-h-[calc(100vh-160px)]"
          >
            <img
              ref={imgRef}
              src={imgSrc}
              alt=""
              onLoad={onImageLoad}
              className="max-h-[calc(100vh-160px)] max-w-full object-contain"
              crossOrigin="anonymous"
            />
          </ReactCrop>
        </div>
      </div>

      {/* Result destination (save mode, not overwrite) */}
      {mode === 'save' && !overwrite && (
        <div className="px-4 py-1 bg-black/80 border-t border-white/10">
          <div className="[&_*]:text-white/70 [&_button]:bg-white/10 [&_button]:hover:bg-white/20 [&_button]:border-white/10">
            <ResultDestination
              personId={targetPersonId}
              albumId={targetAlbumId}
              onLocationChange={(pid, aid) => { setTargetPersonId(pid); setTargetAlbumId(aid) }}
              linkParent={linkParent}
              onLinkParentChange={setLinkParent}
            />
          </div>
        </div>
      )}

      {/* Bottom action bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/80 border-t border-white/10">
        <Button variant="ghost" className="text-white/70 hover:text-white" onClick={onClose}>
          <X className="w-4 h-4 mr-1" />
          取消
        </Button>

        <div className="flex items-center gap-3">
          {mode === 'save' && (
            <label className="flex items-center gap-2 text-sm text-white/70 cursor-pointer">
              <input
                type="checkbox"
                checked={overwrite}
                onChange={(e) => setOverwrite(e.target.checked)}
                className="rounded border-white/30"
              />
              覆盖原图
            </label>
          )}
          <Button
            onClick={handleConfirm}
            disabled={!completedCrop?.width || !completedCrop?.height}
            className="gap-1"
          >
            <Check className="w-4 h-4" />
            确认裁剪
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
