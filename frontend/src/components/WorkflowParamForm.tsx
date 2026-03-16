import { ImagePlus, Paintbrush, Crop, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CategoryParam } from '@/api/workflows'
import { mediaApi, MediaItem } from '@/api/media'

/** Inline toggle switch — replaces checkbox for bool params */
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        checked ? 'bg-primary' : 'bg-input'
      }`}
      onClick={() => onChange(!checked)}
    >
      <span
        className={`pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

export const SOURCE_IMAGE_NAMES = ['source_image', 'base_image']

export function isSourceImageParam(p: { type: string; name: string }) {
  return p.type === 'image' && SOURCE_IMAGE_NAMES.includes(p.name)
}

export function isMaskParam(p: { type: string; source?: string }) {
  return p.type === 'image' && p.source === 'file_path'
}

interface ExtraParam {
  name: string
  label: string
  type: string
  node_id: string
  key: string
  source?: string
  choices?: string[]
}

export interface WorkflowParamFormProps {
  categoryParams: CategoryParam[]
  extraParams?: ExtraParam[]
  params: Record<string, any>
  onParamChange: (name: string, value: any) => void
  onParamClear: (name: string) => void
  mediaThumbs: Record<string, string>
  maskPreview: Record<string, string>
  /** Called when user wants to pick an image for a param */
  onPickImage: (paramName: string) => void
  /** Called when user wants to draw a mask for a param */
  onDrawMask: (paramName: string) => void
  /** Called when user wants to crop an image for a param */
  onCropImage?: (paramName: string) => void
  /** Crop preview URL by param name */
  cropPreview?: Record<string, string>
  /** If provided, source image params auto-filled with this media show read-only */
  sourceMedia?: MediaItem | null
  /** Whether mask drawing is possible (e.g. base image selected) */
  canDrawMask?: boolean
}

export function WorkflowParamForm({
  categoryParams,
  extraParams,
  params,
  onParamChange,
  onParamClear,
  mediaThumbs,
  maskPreview,
  onPickImage,
  onDrawMask,
  onCropImage,
  cropPreview,
  sourceMedia,
  canDrawMask = true,
}: WorkflowParamFormProps) {
  return (
    <>
      {categoryParams.map(param => (
        <ParamField
          key={param.name}
          name={param.name}
          label={param.label}
          type={param.type}
          required={param.required}
          source={param.source}
          value={params[param.name]}
          thumbUrl={mediaThumbs[param.name]}
          maskPreviewUrl={maskPreview[param.name]}
          sourceMedia={
            isSourceImageParam(param) && sourceMedia && params[param.name] === sourceMedia?.id
              ? sourceMedia
              : undefined
          }
          canDrawMask={canDrawMask}
          onChange={v => onParamChange(param.name, v)}
          onClear={() => onParamClear(param.name)}
          onPickImage={() => onPickImage(param.name)}
          onDrawMask={() => onDrawMask(param.name)}
          onCropImage={onCropImage ? () => onCropImage(param.name) : undefined}
          cropPreviewUrl={cropPreview?.[param.name]}
        />
      ))}

      {extraParams && extraParams.length > 0 && (
        <>
          <div className="border-t border-border pt-3 mt-1">
            <p className="text-xs text-muted-foreground mb-3">额外参数</p>
          </div>
          {extraParams.map(ep => (
            <ParamField
              key={ep.name}
              name={ep.name}
              label={ep.label || ep.name}
              type={ep.type}
              source={ep.source}
              choices={ep.choices}
              value={params[ep.name]}
              thumbUrl={mediaThumbs[ep.name]}
              maskPreviewUrl={maskPreview[ep.name]}
              canDrawMask={canDrawMask}
              onChange={v => onParamChange(ep.name, v)}
              onClear={() => onParamClear(ep.name)}
              onPickImage={() => onPickImage(ep.name)}
              onDrawMask={() => onDrawMask(ep.name)}
              onCropImage={onCropImage ? () => onCropImage(ep.name) : undefined}
              cropPreviewUrl={cropPreview?.[ep.name]}
            />
          ))}
        </>
      )}
    </>
  )
}

/** Single param field renderer */
function ParamField({
  name,
  label,
  type,
  required,
  source,
  choices,
  value,
  thumbUrl,
  maskPreviewUrl,
  sourceMedia,
  canDrawMask = true,
  onChange,
  onClear,
  onPickImage,
  onDrawMask,
  onCropImage,
  cropPreviewUrl,
}: {
  name: string
  label: string
  type: string
  required?: boolean
  source?: string
  choices?: string[]
  value: any
  thumbUrl?: string
  maskPreviewUrl?: string
  sourceMedia?: MediaItem
  canDrawMask?: boolean
  onChange: (v: any) => void
  onClear: () => void
  onPickImage: () => void
  onDrawMask: () => void
  onCropImage?: () => void
  cropPreviewUrl?: string
}) {
  // Source image: auto-filled, show read-only + optional crop button
  if (sourceMedia) {
    return (
      <div className="space-y-1">
        <label className="text-sm text-muted-foreground">{label}</label>
        <div className="flex items-center gap-2 bg-muted rounded-md px-2 py-1.5">
          {cropPreviewUrl ? (
            <img src={cropPreviewUrl} alt="裁剪预览" className="w-8 h-8 rounded object-cover shrink-0 border border-primary/50" />
          ) : (
            <img src={mediaApi.itemThumbUrl(sourceMedia, 80)} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
          )}
          <span className="text-sm text-muted-foreground truncate flex-1">
            {cropPreviewUrl ? '已裁剪' : '已自动填入'}
          </span>
          {onCropImage && (
            <button
              className="text-muted-foreground hover:text-foreground shrink-0 p-0.5"
              onClick={onCropImage}
              title="裁剪"
            >
              <Crop className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    )
  }

  // Mask param (source: file_path)
  if (isMaskParam({ type, source })) {
    return (
      <div className="space-y-1">
        <label className="text-sm text-muted-foreground">
          {label}
          {required && <span className="text-destructive ml-0.5">*</span>}
        </label>
        {value ? (
          <div className="flex items-center gap-2">
            {maskPreviewUrl && (
              <img
                src={maskPreviewUrl}
                alt="遮罩预览"
                className="w-16 h-16 rounded border object-contain bg-neutral-900 shrink-0"
              />
            )}
            <div className="flex-1 flex gap-2">
              <Button variant="outline" size="sm" onClick={onDrawMask}>
                <Paintbrush className="w-4 h-4 mr-1" />
                重新绘制
              </Button>
              <Button variant="ghost" size="sm" onClick={onClear}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-1.5"
            disabled={!canDrawMask}
            onClick={onDrawMask}
          >
            <Paintbrush className="w-4 h-4" />
            {canDrawMask ? '绘制遮罩' : '请先选择原图'}
          </Button>
        )}
      </div>
    )
  }

  // Regular image param
  if (type === 'image') {
    return (
      <div className="space-y-1">
        <label className="text-sm text-muted-foreground">
          {label}
          {required && <span className="text-destructive ml-0.5">*</span>}
        </label>
        <div className="flex items-center gap-2">
          {value ? (
            <div className="flex items-center gap-2 flex-1 min-w-0 bg-muted rounded-md px-2 py-1.5">
              {cropPreviewUrl ? (
                <img src={cropPreviewUrl} alt="裁剪预览" className="w-8 h-8 rounded object-cover shrink-0 border border-primary/50" />
              ) : thumbUrl ? (
                <img src={thumbUrl} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
              ) : null}
              <span className="text-sm truncate flex-1">{cropPreviewUrl ? '已裁剪' : value}</span>
              {onCropImage && (
                <button className="text-muted-foreground hover:text-foreground shrink-0 p-0.5" onClick={onCropImage} title="裁剪">
                  <Crop className="w-3.5 h-3.5" />
                </button>
              )}
              <button className="text-muted-foreground hover:text-foreground shrink-0" onClick={onClear}>
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={onPickImage}>
              <ImagePlus className="w-4 h-4" />
              选择图片
            </Button>
          )}
        </div>
      </div>
    )
  }

  // Combo/dropdown param — has predefined choices
  if (choices && choices.length > 0) {
    return (
      <div className="space-y-1">
        <label className="text-sm text-muted-foreground">
          {label}
          {required && <span className="text-destructive ml-0.5">*</span>}
        </label>
        <Select value={value ?? ''} onValueChange={onChange}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={`选择${label}...`} />
          </SelectTrigger>
          <SelectContent>
            {choices.map(c => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  // String param
  if (type === 'string') {
    return (
      <div className="space-y-1">
        <label className="text-sm text-muted-foreground">
          {label}
          {required && <span className="text-destructive ml-0.5">*</span>}
        </label>
        <textarea
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
          rows={2}
          placeholder={label}
          value={value ?? ''}
          onChange={e => onChange(e.target.value)}
        />
      </div>
    )
  }

  // Bool param — toggle switch
  if (type === 'bool') {
    return (
      <div className="space-y-1">
        <label className="flex items-center justify-between gap-2 cursor-pointer">
          <span className="text-sm text-muted-foreground">{label}</span>
          <Toggle checked={!!value} onChange={v => onChange(v)} />
        </label>
      </div>
    )
  }

  // Number param (int/float)
  return (
    <div className="space-y-1">
      <label className="text-sm text-muted-foreground">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      <Input
        type="number"
        step={type === 'float' ? '0.01' : '1'}
        placeholder={label}
        value={value ?? ''}
        onChange={e => {
          const v = type === 'float' ? parseFloat(e.target.value) : parseInt(e.target.value)
          onChange(isNaN(v) ? '' : v)
        }}
      />
    </div>
  )
}
