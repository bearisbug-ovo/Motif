import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, Paintbrush, Eraser, Undo2, Redo2, Trash2, Check } from 'lucide-react'
import { mediaApi, MediaItem } from '@/api/media'
import { Button } from '@/components/ui/button'
import { isTouch } from '@/hooks/useDevice'

type Tool = 'brush' | 'eraser'

interface MaskEditorProps {
  open: boolean
  onClose: () => void
  media?: MediaItem | null
  canvasSize?: { w: number; h: number }
  onComplete: (maskBlob: Blob) => void
}

export function MaskEditor({ open, onClose, media, canvasSize, onComplete }: MaskEditorProps) {
  const isMobile = isTouch

  // Canvas refs
  const displayCanvasRef = useRef<HTMLCanvasElement>(null)
  const maskCanvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Image state
  const imageRef = useRef<HTMLImageElement | null>(null)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imgNaturalW, setImgNaturalW] = useState(0)
  const [imgNaturalH, setImgNaturalH] = useState(0)

  // Tool state
  const [tool, setTool] = useState<Tool>('brush')
  const [brushSize, setBrushSize] = useState(isMobile ? 20 : 40)
  const drawingRef = useRef(false)

  // Undo/redo
  const undoStack = useRef<ImageData[]>([])
  const redoStack = useRef<ImageData[]>([])
  const MAX_UNDO = 50

  // Pan/zoom
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const isPanning = useRef(false)
  const panStart = useRef({ x: 0, y: 0 })
  const offsetStart = useRef({ x: 0, y: 0 })

  // Pinch-to-zoom tracking
  const activePointers = useRef(new Map<number, { x: number; y: number }>())
  const pinchState = useRef<{ startDist: number; startZoom: number; startOffset: { x: number; y: number }; center: { x: number; y: number } } | null>(null)

  // Touch draw delay: wait briefly before drawing to detect multi-touch
  const touchDrawTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingDrawStart = useRef<{ x: number; y: number } | null>(null)
  // Snapshot before stroke starts, used to undo partial strokes on pinch
  const preStrokeSnapshot = useRef<ImageData | null>(null)

  const brushMax = isMobile ? 100 : 200

  // Load image (or init from canvasSize)
  useEffect(() => {
    if (!open) return

    if (media) {
      setImageLoaded(false)
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        imageRef.current = img
        setImgNaturalW(img.naturalWidth)
        setImgNaturalH(img.naturalHeight)
        setImageLoaded(true)

        const mc = maskCanvasRef.current
        if (mc) {
          mc.width = img.naturalWidth
          mc.height = img.naturalHeight
          mc.getContext('2d')!.clearRect(0, 0, mc.width, mc.height)
        }

        undoStack.current = []
        redoStack.current = []
        pushUndo()
        fitToContainer()
      }
      img.src = mediaApi.serveUrl(media.file_path)

      return () => { imageRef.current = null }
    } else if (canvasSize) {
      imageRef.current = null
      setImgNaturalW(canvasSize.w)
      setImgNaturalH(canvasSize.h)
      setImageLoaded(true)

      const mc = maskCanvasRef.current
      if (mc) {
        mc.width = canvasSize.w
        mc.height = canvasSize.h
        mc.getContext('2d')!.clearRect(0, 0, mc.width, mc.height)
      }

      undoStack.current = []
      redoStack.current = []
      pushUndo()
      fitToContainer()
    }
  }, [open, media, canvasSize])

  const fitToContainer = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const cw = container.clientWidth
    const ch = container.clientHeight
    const iw = imageRef.current?.naturalWidth || imgNaturalW
    const ih = imageRef.current?.naturalHeight || imgNaturalH
    if (!iw || !ih) return
    const scale = Math.min(cw / iw, ch / ih, 1)
    setZoom(scale)
    setOffset({
      x: (cw - iw * scale) / 2,
      y: (ch - ih * scale) / 2,
    })
  }, [imgNaturalW, imgNaturalH])

  // Redraw display canvas
  const redraw = useCallback(() => {
    const dc = displayCanvasRef.current
    const mc = maskCanvasRef.current
    if (!dc || !mc || !imageLoaded) return

    const container = containerRef.current
    if (!container) return
    dc.width = container.clientWidth
    dc.height = container.clientHeight

    const ctx = dc.getContext('2d')!
    ctx.clearRect(0, 0, dc.width, dc.height)

    const w = imgNaturalW * zoom
    const h = imgNaturalH * zoom

    // Draw base image or grey background
    if (imageRef.current) {
      ctx.drawImage(imageRef.current, offset.x, offset.y, w, h)
    } else {
      ctx.fillStyle = '#444'
      ctx.fillRect(offset.x, offset.y, w, h)
    }

    // Draw mask overlay (green semi-transparent)
    ctx.save()
    ctx.globalAlpha = 0.4
    ctx.drawImage(mc, offset.x, offset.y, w, h)
    ctx.restore()
  }, [zoom, offset, imageLoaded, imgNaturalW, imgNaturalH])

  useEffect(() => { redraw() }, [redraw])

  // Resize observer
  useEffect(() => {
    if (!open) return
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => redraw())
    ro.observe(container)
    return () => ro.disconnect()
  }, [open, redraw])

  // Push undo state
  const pushUndo = useCallback(() => {
    const mc = maskCanvasRef.current
    if (!mc) return
    const ctx = mc.getContext('2d')!
    const data = ctx.getImageData(0, 0, mc.width, mc.height)
    undoStack.current.push(data)
    if (undoStack.current.length > MAX_UNDO) undoStack.current.shift()
    redoStack.current = []
  }, [])

  const handleUndo = useCallback(() => {
    const mc = maskCanvasRef.current
    if (!mc || undoStack.current.length <= 1) return
    const current = undoStack.current.pop()!
    redoStack.current.push(current)
    const prev = undoStack.current[undoStack.current.length - 1]
    mc.getContext('2d')!.putImageData(prev, 0, 0)
    redraw()
  }, [redraw])

  const handleRedo = useCallback(() => {
    const mc = maskCanvasRef.current
    if (!mc || redoStack.current.length === 0) return
    const next = redoStack.current.pop()!
    undoStack.current.push(next)
    mc.getContext('2d')!.putImageData(next, 0, 0)
    redraw()
  }, [redraw])

  const handleClear = useCallback(() => {
    const mc = maskCanvasRef.current
    if (!mc) return
    mc.getContext('2d')!.clearRect(0, 0, mc.width, mc.height)
    pushUndo()
    redraw()
  }, [pushUndo, redraw])

  // Convert screen coords to mask coords
  const screenToMask = useCallback((sx: number, sy: number) => {
    return {
      x: (sx - offset.x) / zoom,
      y: (sy - offset.y) / zoom,
    }
  }, [zoom, offset])

  // Draw on mask
  const drawAt = useCallback((sx: number, sy: number) => {
    const mc = maskCanvasRef.current
    if (!mc) return
    const ctx = mc.getContext('2d')!
    const { x, y } = screenToMask(sx, sy)
    const r = brushSize / zoom / 2

    if (tool === 'brush') {
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = 'rgba(0, 200, 0, 1)'
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalCompositeOperation = 'source-over'
    }
    redraw()
  }, [screenToMask, brushSize, zoom, tool, redraw])

  const getDist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)

  // Cancel any pending touch draw
  const cancelPendingDraw = useCallback(() => {
    if (touchDrawTimer.current) {
      clearTimeout(touchDrawTimer.current)
      touchDrawTimer.current = null
    }
    pendingDrawStart.current = null
  }, [])

  // Revert any partial stroke drawn before pinch was detected
  const revertPartialStroke = useCallback(() => {
    const mc = maskCanvasRef.current
    if (!mc || !preStrokeSnapshot.current) return
    mc.getContext('2d')!.putImageData(preStrokeSnapshot.current, 0, 0)
    preStrokeSnapshot.current = null
    redraw()
  }, [redraw])

  // Actually begin drawing (called immediately for mouse, after delay for touch)
  const beginStroke = useCallback((sx: number, sy: number) => {
    const mc = maskCanvasRef.current
    if (!mc) return
    // Save snapshot before stroke for potential revert
    preStrokeSnapshot.current = mc.getContext('2d')!.getImageData(0, 0, mc.width, mc.height)
    drawingRef.current = true
    drawAt(sx, sy)
  }, [drawAt])

  // Pointer handlers
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const rect = displayCanvasRef.current?.getBoundingClientRect()
    if (!rect) return

    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    e.currentTarget.setPointerCapture(e.pointerId)

    if (activePointers.current.size === 2) {
      // Second finger: cancel any drawing, revert partial stroke, enter pinch
      cancelPendingDraw()
      if (drawingRef.current) {
        drawingRef.current = false
        revertPartialStroke()
      }
      const pts = Array.from(activePointers.current.values())
      const dist = getDist(pts[0], pts[1])
      const cx = (pts[0].x + pts[1].x) / 2 - rect.left
      const cy = (pts[0].y + pts[1].y) / 2 - rect.top
      pinchState.current = {
        startDist: dist,
        startZoom: zoom,
        startOffset: { ...offset },
        center: { x: cx, y: cy },
      }
      return
    }

    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      isPanning.current = true
      panStart.current = { x: e.clientX, y: e.clientY }
      offsetStart.current = { ...offset }
      return
    }

    if (e.button === 0 && activePointers.current.size === 1) {
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      if (e.pointerType === 'touch') {
        // Delay drawing to detect potential multi-touch
        pendingDrawStart.current = { x: sx, y: sy }
        touchDrawTimer.current = setTimeout(() => {
          touchDrawTimer.current = null
          if (pendingDrawStart.current && activePointers.current.size === 1) {
            beginStroke(pendingDrawStart.current.x, pendingDrawStart.current.y)
            pendingDrawStart.current = null
          }
        }, 80)
      } else {
        beginStroke(sx, sy)
      }
    }
  }, [offset, zoom, beginStroke, cancelPendingDraw, revertPartialStroke])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const rect = displayCanvasRef.current?.getBoundingClientRect()
    if (!rect) return

    if (activePointers.current.has(e.pointerId)) {
      activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    }

    if (activePointers.current.size === 2 && pinchState.current) {
      const pts = Array.from(activePointers.current.values())
      const dist = getDist(pts[0], pts[1])
      const scale = dist / pinchState.current.startDist
      const newZoom = Math.max(0.1, Math.min(10, pinchState.current.startZoom * scale))
      const cx = (pts[0].x + pts[1].x) / 2 - rect.left
      const cy = (pts[0].y + pts[1].y) / 2 - rect.top
      const { center: startCenter, startOffset, startZoom } = pinchState.current
      setOffset({
        x: cx - (startCenter.x - startOffset.x) * (newZoom / startZoom) + (cx - startCenter.x),
        y: cy - (startCenter.y - startOffset.y) * (newZoom / startZoom) + (cy - startCenter.y),
      })
      setZoom(newZoom)
      return
    }

    if (isPanning.current) {
      setOffset({
        x: offsetStart.current.x + (e.clientX - panStart.current.x),
        y: offsetStart.current.y + (e.clientY - panStart.current.y),
      })
      return
    }

    if (!drawingRef.current) return
    drawAt(e.clientX - rect.left, e.clientY - rect.top)
  }, [drawAt])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}
    activePointers.current.delete(e.pointerId)

    cancelPendingDraw()

    if (pinchState.current) {
      if (activePointers.current.size === 0) {
        pinchState.current = null
      }
      return
    }

    if (isPanning.current) {
      isPanning.current = false
      return
    }
    if (drawingRef.current) {
      drawingRef.current = false
      preStrokeSnapshot.current = null
      pushUndo()
    }
  }, [pushUndo, cancelPendingDraw])

  // Wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const rect = displayCanvasRef.current?.getBoundingClientRect()
    if (!rect) return

    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const factor = e.deltaY < 0 ? 1.1 : 0.9
    const newZoom = Math.max(0.1, Math.min(10, zoom * factor))

    setOffset(prev => ({
      x: mx - (mx - prev.x) * (newZoom / zoom),
      y: my - (my - prev.y) * (newZoom / zoom),
    }))
    setZoom(newZoom)
  }, [zoom])

  // Clean up touch timer on close/unmount
  useEffect(() => {
    if (!open) {
      cancelPendingDraw()
      drawingRef.current = false
      preStrokeSnapshot.current = null
    }
  }, [open, cancelPendingDraw])

  // Keyboard shortcuts
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); handleUndo() }
      if (e.ctrlKey && e.key === 'y') { e.preventDefault(); handleRedo() }
      if (e.key === 'b') setTool('brush')
      if (e.key === 'e') setTool('eraser')
      if (e.key === '[') setBrushSize(s => Math.max(5, s - 5))
      if (e.key === ']') setBrushSize(s => Math.min(brushMax, s + 5))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, handleUndo, handleRedo, brushMax])

  // Export mask as RGBA PNG
  const exportMask = useCallback((): Blob | null => {
    const mc = maskCanvasRef.current
    if (!mc) return null

    const exportCanvas = document.createElement('canvas')
    exportCanvas.width = mc.width
    exportCanvas.height = mc.height
    const ctx = exportCanvas.getContext('2d')!

    ctx.fillStyle = 'rgba(255, 255, 255, 1)'
    ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height)

    const maskCtx = mc.getContext('2d')!
    const maskData = maskCtx.getImageData(0, 0, mc.width, mc.height)
    const exportData = ctx.getImageData(0, 0, exportCanvas.width, exportCanvas.height)

    for (let i = 0; i < maskData.data.length; i += 4) {
      if (maskData.data[i + 3] > 0) {
        exportData.data[i] = 0
        exportData.data[i + 1] = 0
        exportData.data[i + 2] = 0
        exportData.data[i + 3] = 0
      }
    }

    ctx.putImageData(exportData, 0, 0)

    const dataUrl = exportCanvas.toDataURL('image/png')
    const arr = dataUrl.split(',')
    const mime = arr[0].match(/:(.*?);/)![1]
    const bstr = atob(arr[1])
    let n = bstr.length
    const u8arr = new Uint8Array(n)
    while (n--) u8arr[n] = bstr.charCodeAt(n)
    return new Blob([u8arr], { type: mime })
  }, [])

  // Handle confirm
  const handleConfirm = useCallback(() => {
    const blob = exportMask()
    if (blob) onComplete(blob)
  }, [exportMask, onComplete])

  if (!open) return null
  if (!media && !canvasSize) return null

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-background flex flex-col">
      {/* Top toolbar */}
      <div className="flex items-center gap-1 sm:gap-2 px-2 sm:px-4 h-12 border-b border-border shrink-0 overflow-x-auto">
        <Button variant="ghost" size="sm" onClick={onClose}>
          <ArrowLeft className="w-4 h-4 sm:mr-1" />
          <span className="hidden sm:inline">返回</span>
        </Button>

        <div className="w-px h-6 bg-border mx-0.5 sm:mx-1" />

        <Button
          variant={tool === 'brush' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setTool('brush')}
          title="画笔 (B)"
        >
          <Paintbrush className="w-4 h-4" />
        </Button>
        <Button
          variant={tool === 'eraser' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setTool('eraser')}
          title="橡皮擦 (E)"
        >
          <Eraser className="w-4 h-4" />
        </Button>

        <div className="w-px h-6 bg-border mx-0.5 sm:mx-1" />

        <Button variant="ghost" size="sm" onClick={handleUndo} title="撤销 (Ctrl+Z)">
          <Undo2 className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={handleRedo} title="重做 (Ctrl+Y)">
          <Redo2 className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={handleClear} title="清除全部">
          <Trash2 className="w-4 h-4" />
        </Button>

        <div className="w-px h-6 bg-border mx-0.5 sm:mx-1" />

        <label className="text-xs text-muted-foreground whitespace-nowrap hidden sm:inline">画笔大小</label>
        <input
          type="range"
          min={5}
          max={brushMax}
          value={brushSize}
          onChange={e => setBrushSize(parseInt(e.target.value))}
          className="w-16 sm:w-24"
        />
        <span className="text-xs text-muted-foreground w-8">{brushSize}</span>
      </div>

      {/* Canvas area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden bg-neutral-900 relative"
        style={{ cursor: tool === 'brush' ? 'crosshair' : 'cell', touchAction: 'none' }}
      >
        <canvas
          ref={displayCanvasRef}
          className="absolute inset-0"
          style={{ touchAction: 'none' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onWheel={handleWheel}
        />
        <canvas ref={maskCanvasRef} className="hidden" />
      </div>

      {/* Bottom bar: Cancel + Confirm */}
      <div className="flex items-center justify-end gap-3 px-4 py-3 border-t border-border shrink-0 bg-card">
        <Button variant="outline" onClick={onClose}>
          取消
        </Button>
        <Button onClick={handleConfirm}>
          <Check className="w-4 h-4 mr-1" />
          确认遮罩
        </Button>
      </div>
    </div>,
    document.body
  )
}
