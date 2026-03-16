import { useRef, useState, useEffect, useCallback, useMemo, CSSProperties, RefObject } from 'react'
import { getZoomDefault, ZoomPageKey } from '@/lib/zoomDefaults'
import { isTouch } from '@/hooks/useDevice'

/** @deprecated Use `isTouch` from `@/hooks/useDevice` instead */
export const isMobile = isTouch

interface UseGridZoomOptions {
  pageKey: ZoomPageKey
  min?: number
  max?: number
}

interface UseGridZoomResult {
  value: number
  containerRef: RefObject<HTMLDivElement>
  gridStyle: CSSProperties
  gapPx: number
}

function getGapPx(cols: number): number {
  if (isMobile) return 1
  if (cols <= 2) return 16
  if (cols <= 5) return 8
  if (cols <= 8) return 6
  if (cols <= 12) return 4
  if (cols <= 15) return 2
  return 1
}

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val))
}

export function useGridZoom({ pageKey, min = 1, max = 30 }: UseGridZoomOptions): UseGridZoomResult {
  const platform = isMobile ? 'mobile' : 'desktop'
  const defaultValue = getZoomDefault(pageKey, platform)
  const containerRef = useRef<HTMLDivElement>(null)
  const [value, setValue] = useState(() => clamp(defaultValue, min, max))

  // Always reset to configured default on mount / pageKey change
  useEffect(() => {
    const v = getZoomDefault(pageKey, platform)
    setValue(clamp(v, min, max))
  }, [pageKey, platform, min, max])

  // Pinch state refs
  const pinchRef = useRef({
    active: false,
    startDist: 0,
    startValue: 0,
    rafId: 0,
    suppressClick: false,
    suppressTimer: 0,
  })

  const step = useCallback((direction: 1 | -1) => {
    // direction: 1 = bigger items (fewer cols), -1 = smaller items (more cols)
    setValue(prev => clamp(prev - direction, min, max))
  }, [min, max])

  // Ctrl+Wheel — document-level to intercept browser zoom
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      // deltaY > 0 = scroll down = more cols (smaller items)
      // deltaY < 0 = scroll up = fewer cols (bigger items)
      step(e.deltaY > 0 ? -1 : 1)
    }
    document.addEventListener('wheel', onWheel, { passive: false })
    return () => document.removeEventListener('wheel', onWheel)
  }, [step])

  // Pinch-to-zoom (mobile)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    function getTouchDist(e: TouchEvent): number {
      if (e.touches.length < 2) return 0
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      return Math.sqrt(dx * dx + dy * dy)
    }

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinchRef.current.startDist = getTouchDist(e)
        pinchRef.current.startValue = value
        pinchRef.current.active = false
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2) return
      // Immediately lock scrolling when 2 fingers detected
      e.preventDefault()

      const dist = getTouchDist(e)
      const delta = dist - pinchRef.current.startDist

      if (!pinchRef.current.active) {
        if (Math.abs(delta) < 20) return
        pinchRef.current.active = true
      }

      cancelAnimationFrame(pinchRef.current.rafId)
      pinchRef.current.rafId = requestAnimationFrame(() => {
        // Each 40px = 1 column step; pinch out = fewer cols (bigger), pinch in = more cols (smaller)
        const steps = Math.round(delta / 40)
        setValue(clamp(pinchRef.current.startValue - steps, min, max))
      })
    }

    const onTouchEnd = () => {
      if (pinchRef.current.active) {
        pinchRef.current.active = false
        pinchRef.current.suppressClick = true
        clearTimeout(pinchRef.current.suppressTimer)
        pinchRef.current.suppressTimer = window.setTimeout(() => {
          pinchRef.current.suppressClick = false
        }, 300)
      }
    }

    const onClick = (e: MouseEvent) => {
      if (pinchRef.current.suppressClick) {
        e.preventDefault()
        e.stopPropagation()
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('click', onClick, { capture: true })

    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('click', onClick, { capture: true })
      cancelAnimationFrame(pinchRef.current.rafId)
      clearTimeout(pinchRef.current.suppressTimer)
    }
  }, [value, min, max])

  const gapPx = getGapPx(value)

  const gridStyle = useMemo<CSSProperties>(() => ({
    display: 'grid',
    gridTemplateColumns: `repeat(${value}, 1fr)`,
    gap: `${gapPx}px`,
    touchAction: 'pan-y',
  }), [value, gapPx])

  return { value, containerRef, gridStyle, gapPx }
}
