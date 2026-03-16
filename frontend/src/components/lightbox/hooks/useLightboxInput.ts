import { useEffect, useCallback, useRef } from 'react'
import { useLightboxStore } from '@/stores/lightbox'
import { useMediaStore } from '@/stores/media'
import { isTouch } from '@/hooks/useDevice'
import { claimGesture, resetArbiter, type TouchArbiter } from '../../video/hooks/useTouchArbiter'
import type { useImageZoom } from '@/hooks/useImageZoom'

interface UseLightboxInputOptions {
  isVideo: boolean
  isLandscape: boolean
  immersive: boolean
  zoom: ReturnType<typeof useImageZoom>
  setOverlayVisible: (v: boolean | ((prev: boolean) => boolean)) => void
  setIsLandscape: (v: boolean) => void
  setImmersive: (v: boolean) => void
  setContextMenu: (v: { x: number; y: number } | null) => void
  setMobileRatingPopup: (v: boolean) => void
  mobileRatingTimer: React.MutableRefObject<ReturnType<typeof setTimeout> | undefined>
  arbiterRef: React.MutableRefObject<TouchArbiter>
  /** When true, all input handling is suppressed (e.g. crop/trim editor open) */
  disabled?: boolean
}

export function useLightboxInput({
  isVideo, isLandscape, immersive, zoom,
  setOverlayVisible, setIsLandscape, setImmersive, setContextMenu,
  setMobileRatingPopup, mobileRatingTimer, arbiterRef, disabled,
}: UseLightboxInputOptions) {
  const wheelTimeout = useRef<ReturnType<typeof setTimeout>>()

  // Touch swipe state
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const touchStartTime = useRef(0)
  const touchDeltaX = useRef(0)
  const touchDeltaY = useRef(0)
  const swiping = useRef(false)
  const swipingVertical = useRef(false)
  const twoFingerTapped = useRef(false)

  // Double-tap for mobile immersive rating popup
  const lastTapRef = useRef(0)

  // Keyboard handler
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (disabled) return
    const state = useLightboxStore.getState()
    if (!state.isOpen) return

    // Don't capture keys when focus is in an input field (e.g. workflow parameter dialogs)
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) {
      return
    }

    if (e.key === 'Escape') {
      if (zoom.isZoomed) { zoom.resetZoom(); return }
      if (isLandscape) { setIsLandscape(false); return }
      if (immersive) {
        setImmersive(false)
        document.exitFullscreen?.().catch(() => {})
        return
      }
      state.close()
      return
    }

    // Arrow keys — in zoom mode, navigate while keeping zoom
    if (e.key === 'ArrowRight') {
      if (isVideo) return // VideoPlayer handles seek
      state.navigateH(1)
      return
    }
    if (e.key === 'ArrowLeft') {
      if (isVideo) return // VideoPlayer handles seek
      state.navigateH(-1)
      return
    }
    if (e.key === 'ArrowDown') {
      if (isVideo && isLandscape) return // VideoPlayer handles volume
      state.navigateV(1)
      return
    }
    if (e.key === 'ArrowUp') {
      if (isVideo && isLandscape) return // VideoPlayer handles volume
      state.navigateV(-1)
      return
    }

    // Video-specific keys
    if (isVideo && [' ', 'f', 'F'].includes(e.key)) return

    // Rating
    const item = state.currentItem
    if (e.key >= '1' && e.key <= '5' && item) {
      useMediaStore.getState().updateMedia(item.id, { rating: parseInt(e.key) })
      if (immersive && isTouch) {
        setMobileRatingPopup(true)
        clearTimeout(mobileRatingTimer.current)
        mobileRatingTimer.current = setTimeout(() => setMobileRatingPopup(false), 2000)
      }
    }
    if (e.key === '0' && item) {
      useMediaStore.getState().updateMedia(item.id, { rating: null })
    }
  }, [isVideo, isLandscape, immersive, zoom, setIsLandscape, setImmersive, setMobileRatingPopup, mobileRatingTimer, disabled])

  useEffect(() => {
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [handleKey])

  // Mouse wheel handler
  const handleWheel = useCallback((e: WheelEvent) => {
    if (disabled) return
    const state = useLightboxStore.getState()
    if (!state.isOpen) return

    // Don't intercept if target is in thumbnail strip, chain indicator, or a dialog overlay
    const target = e.target as HTMLElement
    if (target.closest('[data-strip]') || target.closest('[data-chain-indicator]') || target.closest('[role="dialog"]')) return

    e.preventDefault()

    if (wheelTimeout.current) return
    if (e.deltaY > 0) state.navigateV(1)
    else if (e.deltaY < 0) state.navigateV(-1)
    wheelTimeout.current = setTimeout(() => { wheelTimeout.current = undefined }, 200)
  }, [disabled])

  // Get isOpen from store for effect dependency
  const lbIsOpen = useLightboxStore(s => s.isOpen)

  useEffect(() => {
    if (!lbIsOpen) return
    document.addEventListener('wheel', handleWheel, { passive: false })
    return () => document.removeEventListener('wheel', handleWheel)
  }, [lbIsOpen, handleWheel])

  // Touch handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (disabled) return
    if (e.touches.length >= 2) {
      if (isVideo) {
        twoFingerTapped.current = true
        resetArbiter(arbiterRef.current)
      } else {
        twoFingerTapped.current = false
      }
      swiping.current = false
      swipingVertical.current = false
      return
    }

    twoFingerTapped.current = false
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    touchStartTime.current = Date.now()
    touchDeltaX.current = 0
    touchDeltaY.current = 0
    swiping.current = false
    swipingVertical.current = false

    if (isVideo) {
      arbiterRef.current.gesture = 'pending'
      arbiterRef.current.startTime = Date.now()
    }
  }, [isVideo, arbiterRef, disabled])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (disabled) return
    if (!isVideo && zoom.isZoomed) return

    if (isVideo) {
      const g = arbiterRef.current.gesture
      if (g === 'seeking' || g === 'speed_control') return
    }

    const dx = e.touches[0].clientX - touchStartX.current
    const dy = e.touches[0].clientY - touchStartY.current

    if (!swiping.current && !swipingVertical.current) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        if (isVideo) {
          if (!claimGesture(arbiterRef.current, 'swiping')) return
        }
        swiping.current = true
      } else if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        if (isVideo) {
          if (!claimGesture(arbiterRef.current, 'swiping_vertical')) return
        }
        swipingVertical.current = true
      }
    }

    if (swiping.current) {
      touchDeltaX.current = dx
      e.preventDefault()
    }
    if (swipingVertical.current) {
      touchDeltaY.current = dy
      e.preventDefault()
    }
  }, [isVideo, zoom.isZoomed, arbiterRef, disabled])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (disabled) return
    // Two-finger tap → context menu
    if (twoFingerTapped.current) {
      twoFingerTapped.current = false
      setContextMenu({ x: touchStartX.current, y: touchStartY.current })
      return
    }

    if (!isVideo && zoom.isZoomed) return

    const state = useLightboxStore.getState()
    const elapsed = Date.now() - touchStartTime.current

    if (swiping.current) {
      const absDx = Math.abs(touchDeltaX.current)
      const velocity = elapsed > 0 ? absDx / elapsed : 0
      const velocityOk = velocity > 0.3 && absDx > 20
      const distanceOk = absDx > 60

      if (velocityOk || distanceOk) {
        if (touchDeltaX.current < 0) state.navigateH(1)
        else state.navigateH(-1)
      }
    }

    if (swipingVertical.current) {
      const absDy = Math.abs(touchDeltaY.current)
      const velocity = elapsed > 0 ? absDy / elapsed : 0
      const velocityOk = velocity > 0.3 && absDy > 20
      const distanceOk = absDy > 60

      if (velocityOk || distanceOk) {
        if (touchDeltaY.current < 0) state.navigateV(1)  // swipe up = go deeper
        else state.navigateV(-1)  // swipe down = go back
      }
    }

    swiping.current = false
    swipingVertical.current = false
    touchDeltaX.current = 0
    touchDeltaY.current = 0

    if (isVideo && (arbiterRef.current.gesture === 'swiping' || arbiterRef.current.gesture === 'swiping_vertical')) {
      resetArbiter(arbiterRef.current)
    }
  }, [isVideo, zoom.isZoomed, setContextMenu, arbiterRef, disabled])

  return {
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  }
}
