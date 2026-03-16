import { useEffect, useRef, useCallback, type RefObject } from 'react'
import { isTouch } from '@/hooks/useDevice'

interface UseImageZoomOptions {
  containerRef: RefObject<HTMLDivElement | null>
  imgRef: RefObject<HTMLImageElement | null>
  enabled: boolean
  onZoomChange?: (isZoomed: boolean) => void
}

interface ZoomState {
  scale: number
  translateX: number
  translateY: number
  fitScale: number
  // mouse position (container-relative)
  mouseX: number
  mouseY: number
  // click detection
  mouseDownX: number
  mouseDownY: number
  mouseDownTime: number
  // visibility (mouse within image bounds)
  visible: boolean
  // pinch
  isPinching: boolean
  pinchStartDist: number
  pinchStartScale: number
  pinchStartTX: number
  pinchStartTY: number
  pinchStartCX: number
  pinchStartCY: number
  // single-finger pan (mobile, when zoomed)
  touchPanStartX: number
  touchPanStartY: number
  touchPanStartTX: number
  touchPanStartTY: number
  isTouchPanning: boolean
  didDrag: boolean
  // animation
  rafId: number
  lastWasZoomed: boolean
  // container dimensions
  containerW: number
  containerH: number
  // double-click
  lastClickTime: number
}

interface UseImageZoomReturn {
  isZoomed: boolean
  resetZoom: () => void
  /** Check if a container-relative point is within the fit image bounds */
  isPointOnImage: (containerX: number, containerY: number) => boolean
}

const MIN_SCALE = 1
const MAX_SCALE = 8
const ZOOM_FACTOR = 1.15
const CLICK_DIST_THRESHOLD = 5
const CLICK_TIME_THRESHOLD = 300
const DOUBLE_CLICK_TIME = 300
const DEFAULT_ZOOM = 2

// SVG magnifier cursor as data URI — browser renders natively, zero lag
const MAGNIFIER_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'><circle cx='12' cy='12' r='8.5' stroke='white' stroke-width='1.5' fill='none' opacity='0.85'/><circle cx='12' cy='12' r='8.5' stroke='black' stroke-width='0.5' fill='none' opacity='0.3'/><line x1='18.5' y1='18.5' x2='25' y2='25' stroke='white' stroke-width='2' stroke-linecap='round' opacity='0.85'/><line x1='18.5' y1='18.5' x2='25' y2='25' stroke='black' stroke-width='0.5' stroke-linecap='round' opacity='0.3'/><line x1='9' y1='12' x2='15' y2='12' stroke='white' stroke-width='1.2' stroke-linecap='round' opacity='0.8'/><line x1='12' y1='9' x2='12' y2='15' stroke='white' stroke-width='1.2' stroke-linecap='round' opacity='0.8'/></svg>`
const MAGNIFIER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(MAGNIFIER_SVG)}") 12 12, auto`

export function useImageZoom({
  containerRef,
  imgRef,
  enabled,
  onZoomChange,
}: UseImageZoomOptions): UseImageZoomReturn {
  const stateRef = useRef<ZoomState>({
    scale: 1,
    translateX: 0,
    translateY: 0,
    fitScale: 1,
    mouseX: 0,
    mouseY: 0,
    mouseDownX: 0,
    mouseDownY: 0,
    mouseDownTime: 0,
    visible: true,
    isPinching: false,
    pinchStartDist: 0,
    pinchStartScale: 1,
    pinchStartTX: 0,
    pinchStartTY: 0,
    pinchStartCX: 0,
    pinchStartCY: 0,
    touchPanStartX: 0,
    touchPanStartY: 0,
    touchPanStartTX: 0,
    touchPanStartTY: 0,
    isTouchPanning: false,
    didDrag: false,
    rafId: 0,
    lastWasZoomed: false,
    containerW: 0,
    containerH: 0,
    lastClickTime: 0,
  })

  const isZoomedRef = useRef(false)
  // Force re-render for isZoomed
  const forceUpdate = useRef(0)
  const setForceUpdate = useCallback(() => { forceUpdate.current++ }, [])

  // Store onZoomChange in ref to avoid cascading dependency changes
  const onZoomChangeRef = useRef(onZoomChange)
  onZoomChangeRef.current = onZoomChange

  // Notify external about zoom changes
  const notifyZoomChange = useCallback((zoomed: boolean) => {
    if (isZoomedRef.current !== zoomed) {
      isZoomedRef.current = zoomed
      onZoomChangeRef.current?.(zoomed)
      setForceUpdate()
    }
  }, [setForceUpdate])

  // Compute fitScale based on natural image size and container dimensions
  const computeFitScale = useCallback(() => {
    const img = imgRef.current
    const container = containerRef.current
    if (!img || !container) return 1
    const natW = img.naturalWidth || 1
    const natH = img.naturalHeight || 1
    const cw = container.clientWidth
    const ch = container.clientHeight
    stateRef.current.containerW = cw
    stateRef.current.containerH = ch
    return Math.min(cw / natW, ch / natH, 1)
  }, [imgRef, containerRef])

  // Check if a container-relative point is within the fit image bounds
  const isPointOnImage = useCallback((cx: number, cy: number): boolean => {
    const img = imgRef.current
    if (!img) return false
    const s = stateRef.current
    const natW = img.naturalWidth || 1
    const natH = img.naturalHeight || 1
    const fitW = natW * s.fitScale
    const fitH = natH * s.fitScale
    const fitX = (s.containerW - fitW) / 2
    const fitY = (s.containerH - fitH) / 2
    const nx = (cx - fitX) / fitW
    const ny = (cy - fitY) / fitH
    return nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1
  }, [imgRef])

  // Compute translate from mouse position so that the point under the mouse
  // on the fit image maps to the same point on the zoomed image.
  const computeTranslateFromMouse = useCallback((mx: number, my: number) => {
    const img = imgRef.current
    if (!img) return { tx: 0, ty: 0, visible: false }
    const s = stateRef.current
    const natW = img.naturalWidth || 1
    const natH = img.naturalHeight || 1

    // Fit image dimensions and position (centered in container)
    const fitW = natW * s.fitScale
    const fitH = natH * s.fitScale
    const fitX = (s.containerW - fitW) / 2
    const fitY = (s.containerH - fitH) / 2

    // Normalized coordinates on the original image
    const nx = (mx - fitX) / fitW
    const ny = (my - fitY) / fitH

    // Out of bounds → hidden
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) {
      return { tx: 0, ty: 0, visible: false }
    }

    // Zoomed image size
    const zoomW = natW * s.scale
    const zoomH = natH * s.scale

    // Position so that (nx, ny) on zoomed image aligns with mouse
    const tx = mx - nx * zoomW
    const ty = my - ny * zoomH

    return { tx, ty, visible: true }
  }, [imgRef])

  // Clamp translate for mobile touch panning (keeps boundary constraints for touch)
  const clampTranslate = useCallback((tx: number, ty: number, scale: number): [number, number] => {
    const img = imgRef.current
    if (!img) return [tx, ty]
    const s = stateRef.current
    const natW = img.naturalWidth || 1
    const natH = img.naturalHeight || 1
    const imgW = natW * scale
    const imgH = natH * scale
    const vw = s.containerW
    const vh = s.containerH

    let cx: number, cy: number
    if (imgW > vw) {
      cx = Math.max(vw - imgW, Math.min(0, tx))
    } else {
      cx = (vw - imgW) / 2
    }
    if (imgH > vh) {
      cy = Math.max(vh - imgH, Math.min(0, ty))
    } else {
      cy = (vh - imgH) / 2
    }
    return [cx, cy]
  }, [imgRef])

  // Apply transform to img element directly (no React re-render)
  const applyTransform = useCallback((animated: boolean = false) => {
    const img = imgRef.current
    if (!img) return
    const s = stateRef.current
    if (animated) {
      img.style.transition = 'transform 0.3s ease-out, opacity 0.15s ease-out'
    } else {
      img.style.transition = 'none'
    }
    img.style.transform = `translate(${s.translateX}px, ${s.translateY}px) scale(${s.scale})`

    // Visibility control in zoom mode
    const zoomed = s.scale > s.fitScale * 1.01
    if (zoomed && !isTouch) {
      img.style.opacity = s.visible ? '1' : '0'
    } else {
      img.style.opacity = '1'
    }

    // Update zoom indicator
    const container = containerRef.current
    if (container) {
      const indicator = container.querySelector('[data-zoom-indicator]') as HTMLElement
      if (indicator) {
        indicator.style.opacity = zoomed ? '1' : '0'
        indicator.style.pointerEvents = 'none'
        indicator.textContent = `${(s.scale / s.fitScale).toFixed(1)}x`
      }
    }

    // Update cursor: magnifier when zoomed + on image, default when off image
    if (container) {
      if (zoomed && !isTouch) {
        container.style.cursor = s.visible ? MAGNIFIER_CURSOR : ''
      } else {
        container.style.cursor = ''
      }
    }

    if (zoomed !== s.lastWasZoomed) {
      s.lastWasZoomed = zoomed
      // Defer notification to avoid calling setState during render
      queueMicrotask(() => notifyZoomChange(zoomed))
    }
  }, [imgRef, containerRef, notifyZoomChange])

  // Zoom to fitScale with animation
  const zoomToFit = useCallback((animated: boolean = true) => {
    const s = stateRef.current
    const fitScale = computeFitScale()
    s.fitScale = fitScale
    s.scale = fitScale
    s.visible = true
    const img = imgRef.current
    if (img) {
      const natW = img.naturalWidth || 1
      const natH = img.naturalHeight || 1
      s.translateX = (s.containerW - natW * fitScale) / 2
      s.translateY = (s.containerH - natH * fitScale) / 2
    }
    applyTransform(animated)
  }, [computeFitScale, imgRef, applyTransform])

  // Zoom at a specific point and immediately recompute from mouse position
  const zoomAtPoint = useCallback((cursorX: number, cursorY: number, newScale: number, animated: boolean = false) => {
    const s = stateRef.current
    const clamped = Math.max(s.fitScale, Math.min(MAX_SCALE, newScale))
    s.scale = clamped

    if (!isTouch) {
      // PC: compute translate from mouse position mapping
      s.mouseX = cursorX
      s.mouseY = cursorY
      const { tx, ty, visible } = computeTranslateFromMouse(cursorX, cursorY)
      s.translateX = tx
      s.translateY = ty
      s.visible = visible
    } else {
      // Mobile: use traditional zoom-at-point with clamp
      const ratio = clamped / s.scale
      let newTX = cursorX - (cursorX - s.translateX) * ratio
      let newTY = cursorY - (cursorY - s.translateY) * ratio
      const [cx, cy] = clampTranslate(newTX, newTY, clamped)
      s.translateX = cx
      s.translateY = cy
    }
    applyTransform(animated)
  }, [computeTranslateFromMouse, clampTranslate, applyTransform])

  // Reset zoom (callable from outside)
  const resetZoom = useCallback(() => {
    if (isZoomedRef.current) {
      zoomToFit(true)
    }
  }, [zoomToFit])

  // Initialize: set img to fit on load
  const initFit = useCallback(() => {
    const img = imgRef.current
    if (!img) return
    const s = stateRef.current
    const container = containerRef.current
    if (!container) return

    s.containerW = container.clientWidth
    s.containerH = container.clientHeight
    s.fitScale = computeFitScale()
    s.scale = s.fitScale
    s.visible = true

    // Position image centered
    const natW = img.naturalWidth || 1
    const natH = img.naturalHeight || 1
    const imgW = natW * s.fitScale
    const imgH = natH * s.fitScale
    s.translateX = (s.containerW - imgW) / 2
    s.translateY = (s.containerH - imgH) / 2

    img.style.transformOrigin = '0 0'
    img.style.willChange = 'transform'
    img.style.position = 'absolute'
    img.style.maxWidth = 'none'
    img.style.maxHeight = 'none'
    img.style.width = `${natW}px`
    img.style.height = `${natH}px`
    applyTransform(false)
  }, [imgRef, containerRef, computeFitScale, applyTransform])

  // Main effect: register all event handlers
  useEffect(() => {
    const container = containerRef.current
    const img = imgRef.current
    if (!container || !img || !enabled) return

    const s = stateRef.current

    // Track current src to detect image switches
    let currentSrc = img.src

    // Always listen for load — fires on every src change (including cached).
    // If currently zoomed, preserve scale; otherwise init to fit.
    const onImgLoad = () => {
      currentSrc = img.src
      const wasZoomed = s.scale > s.fitScale * 1.01
      if (wasZoomed) {
        // Preserve zoom level: recompute fitScale for new image, keep current scale
        s.containerW = container.clientWidth
        s.containerH = container.clientHeight
        s.fitScale = computeFitScale()
        // Set image dimensions for new natural size
        const natW = img.naturalWidth || 1
        const natH = img.naturalHeight || 1
        img.style.width = `${natW}px`
        img.style.height = `${natH}px`
        // Center the zoomed image
        const imgW = natW * s.scale
        const imgH = natH * s.scale
        s.translateX = (s.containerW - imgW) / 2
        s.translateY = (s.containerH - imgH) / 2
        applyTransform(false)
      } else {
        initFit()
      }
    }
    img.addEventListener('load', onImgLoad)

    // Hide image immediately when src changes to prevent aspect-ratio flash
    // (old CSS width/height applied to new image for 1 frame before onImgLoad)
    const srcObserver = new MutationObserver(() => {
      if (img.src !== currentSrc) {
        img.style.opacity = '0'
        img.style.transition = 'none'
      }
    })
    srcObserver.observe(img, { attributes: true, attributeFilter: ['src'] })
    // Also handle already-loaded image for initial setup
    if (img.complete && img.naturalWidth > 0) {
      initFit()
    }

    // ResizeObserver to track container size changes
    const ro = new ResizeObserver(() => {
      const wasFit = s.scale <= s.fitScale * 1.01
      s.containerW = container.clientWidth
      s.containerH = container.clientHeight
      s.fitScale = computeFitScale()
      // If was at fit scale before resize, re-fit to new size
      if (wasFit) {
        zoomToFit(false)
      } else if (!isTouch) {
        // PC zoomed: recompute from current mouse position
        const { tx, ty, visible } = computeTranslateFromMouse(s.mouseX, s.mouseY)
        s.translateX = tx
        s.translateY = ty
        s.visible = visible
        applyTransform(false)
      } else {
        // Mobile: re-clamp
        const [cx, cy] = clampTranslate(s.translateX, s.translateY, s.scale)
        s.translateX = cx
        s.translateY = cy
        applyTransform(false)
      }
    })
    ro.observe(container)

    // ─── Wheel handler ───
    const onWheel = (e: WheelEvent) => {
      const rect = container.getBoundingClientRect()
      const cursorX = e.clientX - rect.left
      const cursorY = e.clientY - rect.top
      const zoomed = s.scale > s.fitScale * 1.01

      // If not zoomed and cursor is on black borders, let event bubble for image switching
      if (!zoomed && !isPointOnImage(cursorX, cursorY)) return

      e.preventDefault()
      e.stopPropagation()

      const direction = e.deltaY < 0 ? 1 : -1  // scroll up = zoom in
      const newScale = s.scale * (direction > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR)

      // If zooming out below fit, snap to fit
      if (newScale <= s.fitScale) {
        zoomToFit(true)
        return
      }

      // Update mouse position and zoom
      s.mouseX = cursorX
      s.mouseY = cursorY
      const clamped = Math.max(s.fitScale, Math.min(MAX_SCALE, newScale))
      s.scale = clamped

      // Recompute translate from mouse position
      const { tx, ty, visible } = computeTranslateFromMouse(cursorX, cursorY)
      s.translateX = tx
      s.translateY = ty
      s.visible = visible
      applyTransform(false)
    }

    // ─── Mouse handlers (PC: move-to-pan + click) ───
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return // only left button
      s.mouseDownX = e.clientX
      s.mouseDownY = e.clientY
      s.mouseDownTime = Date.now()
    }

    const onMouseMove = (e: MouseEvent) => {
      const zoomed = s.scale > s.fitScale * 1.01
      if (!zoomed) return

      const rect = container.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top

      s.mouseX = mx
      s.mouseY = my

      cancelAnimationFrame(s.rafId)
      s.rafId = requestAnimationFrame(() => {
        const { tx, ty, visible } = computeTranslateFromMouse(mx, my)
        s.translateX = tx
        s.translateY = ty
        s.visible = visible
        applyTransform(false)
      })
    }

    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 0) return

      const dist = Math.hypot(e.clientX - s.mouseDownX, e.clientY - s.mouseDownY)
      const elapsed = Date.now() - s.mouseDownTime
      const isClick = dist < CLICK_DIST_THRESHOLD && elapsed < CLICK_TIME_THRESHOLD

      if (!isClick) return

      const rect = container.getBoundingClientRect()
      const cursorX = e.clientX - rect.left
      const cursorY = e.clientY - rect.top
      const zoomed = s.scale > s.fitScale * 1.01

      // Ignore clicks outside the image when not zoomed (don't enter zoom mode from black borders)
      if (!zoomed && !isPointOnImage(cursorX, cursorY)) return

      // Double-click detection
      const now = Date.now()
      if (now - s.lastClickTime < DOUBLE_CLICK_TIME) {
        // Double click: toggle fit ↔ 2x
        s.lastClickTime = 0
        if (zoomed) {
          zoomToFit(true)
        } else {
          zoomAtPoint(cursorX, cursorY, s.fitScale * DEFAULT_ZOOM, true)
        }
        return
      }
      s.lastClickTime = now

      // Defer single-click to wait for possible double-click
      const savedScale = s.scale
      const savedFitScale = s.fitScale
      const savedCursorX = cursorX
      const savedCursorY = cursorY
      setTimeout(() => {
        if (s.lastClickTime !== now) return // double-click happened, skip

        const wasZoomed = savedScale > savedFitScale * 1.01
        if (wasZoomed) {
          zoomToFit(true)
        } else {
          zoomAtPoint(savedCursorX, savedCursorY, s.fitScale * DEFAULT_ZOOM, true)
        }
      }, DOUBLE_CLICK_TIME + 10)
    }

    // ─── Context menu (right-click): exit zoom ───
    const onContextMenu = (e: MouseEvent) => {
      const zoomed = s.scale > s.fitScale * 1.01
      if (zoomed) {
        e.preventDefault()
        e.stopPropagation()
        zoomToFit(true)
      }
      // If not zoomed, let the event bubble for LightBox context menu
    }

    // ─── Touch handlers (mobile pinch + pan) ───
    const getTouchDist = (e: TouchEvent) => {
      if (e.touches.length < 2) return 0
      return Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY,
      )
    }

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        // Start pinch
        s.isPinching = true
        s.pinchStartDist = getTouchDist(e)
        s.pinchStartScale = s.scale
        s.pinchStartTX = s.translateX
        s.pinchStartTY = s.translateY
        const rect = container.getBoundingClientRect()
        s.pinchStartCX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left
        s.pinchStartCY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top
        s.isTouchPanning = false
        return
      }

      // Single finger: start potential pan (only when zoomed)
      const zoomed = s.scale > s.fitScale * 1.01
      if (zoomed && e.touches.length === 1) {
        s.isTouchPanning = true
        s.touchPanStartX = e.touches[0].clientX
        s.touchPanStartY = e.touches[0].clientY
        s.touchPanStartTX = s.translateX
        s.touchPanStartTY = s.translateY
        s.mouseDownX = e.touches[0].clientX
        s.mouseDownY = e.touches[0].clientY
        s.mouseDownTime = Date.now()
        s.didDrag = false
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      if (s.isPinching && e.touches.length >= 2) {
        e.preventDefault()
        const dist = getTouchDist(e)
        const newScale = Math.max(s.fitScale, Math.min(MAX_SCALE, s.pinchStartScale * (dist / s.pinchStartDist)))

        const rect = container.getBoundingClientRect()
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top

        // Zoom at pinch center
        const ratio = newScale / s.pinchStartScale
        let newTX = cx - (s.pinchStartCX - s.pinchStartTX) * ratio
        let newTY = cy - (s.pinchStartCY - s.pinchStartTY) * ratio

        s.scale = newScale
        const [clx, cly] = clampTranslate(newTX, newTY, newScale)
        s.translateX = clx
        s.translateY = cly

        cancelAnimationFrame(s.rafId)
        s.rafId = requestAnimationFrame(() => applyTransform(false))
        return
      }

      if (s.isTouchPanning && e.touches.length === 1) {
        const dx = e.touches[0].clientX - s.touchPanStartX
        const dy = e.touches[0].clientY - s.touchPanStartY
        if (Math.abs(dx) > CLICK_DIST_THRESHOLD || Math.abs(dy) > CLICK_DIST_THRESHOLD) {
          s.didDrag = true
          e.preventDefault()
        }

        cancelAnimationFrame(s.rafId)
        s.rafId = requestAnimationFrame(() => {
          let newTX = s.touchPanStartTX + dx
          let newTY = s.touchPanStartTY + dy
          const [cx, cy] = clampTranslate(newTX, newTY, s.scale)
          s.translateX = cx
          s.translateY = cy
          applyTransform(false)
        })
      }
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (s.isPinching) {
        s.isPinching = false
        // Snap back to fit if close
        if (s.scale < s.fitScale * 1.15) {
          zoomToFit(true)
        }
        return
      }

      if (s.isTouchPanning) {
        s.isTouchPanning = false
        // If it was a tap (no drag), reset zoom
        if (!s.didDrag && e.changedTouches.length > 0) {
          const dist = Math.hypot(
            e.changedTouches[0].clientX - s.mouseDownX,
            e.changedTouches[0].clientY - s.mouseDownY,
          )
          const elapsed = Date.now() - s.mouseDownTime
          if (dist < 10 && elapsed < CLICK_TIME_THRESHOLD) {
            zoomToFit(true)
          }
        }
      }
    }

    // Register events
    container.addEventListener('wheel', onWheel, { passive: false })

    if (!isTouch) {
      container.addEventListener('mousedown', onMouseDown)
      container.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
      container.addEventListener('contextmenu', onContextMenu)
    } else {
      container.addEventListener('touchstart', onTouchStart, { passive: true })
      container.addEventListener('touchmove', onTouchMove, { passive: false })
      container.addEventListener('touchend', onTouchEnd)
    }

    return () => {
      img.removeEventListener('load', onImgLoad)
      srcObserver.disconnect()
      ro.disconnect()
      cancelAnimationFrame(s.rafId)

      container.removeEventListener('wheel', onWheel)

      if (!isTouch) {
        container.removeEventListener('mousedown', onMouseDown)
        container.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        container.removeEventListener('contextmenu', onContextMenu)
      } else {
        container.removeEventListener('touchstart', onTouchStart)
        container.removeEventListener('touchmove', onTouchMove)
        container.removeEventListener('touchend', onTouchEnd)
      }

      // Reset img styles
      img.style.transform = ''
      img.style.transition = ''
      img.style.willChange = ''
      img.style.transformOrigin = ''
      img.style.position = ''
      img.style.maxWidth = ''
      img.style.maxHeight = ''
      img.style.width = ''
      img.style.height = ''
      img.style.opacity = ''
      container.style.cursor = ''
    }
  }, [enabled, containerRef, imgRef, initFit, computeFitScale, zoomToFit, zoomAtPoint, clampTranslate, applyTransform, computeTranslateFromMouse, isPointOnImage])

  // Reset when enabled changes to false (e.g., image switch)
  useEffect(() => {
    if (!enabled) {
      const s = stateRef.current
      s.scale = 1
      s.translateX = 0
      s.translateY = 0
      s.visible = true
      s.isPinching = false
      s.isTouchPanning = false
      s.lastWasZoomed = false
      s.lastClickTime = 0
      isZoomedRef.current = false
      // Reset opacity on img
      const img = imgRef.current
      if (img) {
        img.style.opacity = ''
      }
    }
  }, [enabled, imgRef])

  return {
    get isZoomed() { return isZoomedRef.current },
    resetZoom,
    isPointOnImage,
  }
}
