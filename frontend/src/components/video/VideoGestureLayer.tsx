import { useRef, useCallback } from 'react'
import { TouchArbiter, claimGesture, resetArbiter } from './hooks/useTouchArbiter'
import { isTouch } from '@/hooks/useDevice'

interface VideoGestureLayerProps {
  isLandscape: boolean

  // Speed control callbacks (from useSpeedControl)
  onSpeedPressStart: (x: number, y: number) => void
  onSpeedPressMove: (x: number, y: number) => void
  onSpeedPressEnd: () => void

  // Tap to toggle controls
  onTap: () => void

  // PC: click = play/pause
  onClickPlayPause: () => void

  // Touch arbiter (shared with LightBox)
  touchArbiter?: React.MutableRefObject<TouchArbiter>

  // Seek support (landscape drag-to-seek)
  duration: number
  currentTime: number
  onSeek: (time: number) => void

  // Controls visibility (for showing progress bar during drag-to-seek)
  onSeekingStart?: () => void
  onSeekingEnd?: () => void
}

/**
 * Transparent overlay that handles touch gestures for mobile.
 * - Long press → speed control (delegated to useSpeedControl)
 * - Single tap → toggle controls visibility
 * - In landscape: horizontal drag → seek video; prevents swipe from bubbling to LightBox
 * - Context menu: handled by LightBox via two-finger tap (not here)
 */
export function VideoGestureLayer({
  isLandscape,
  onSpeedPressStart,
  onSpeedPressMove,
  onSpeedPressEnd,
  onTap,
  onClickPlayPause,
  touchArbiter,
  duration,
  currentTime,
  onSeek,
  onSeekingStart,
  onSeekingEnd,
}: VideoGestureLayerProps) {
  const isMobile = isTouch
  const touchStartTime = useRef(0)
  const touchMoved = useRef(false)
  const longPressTimer = useRef<ReturnType<typeof setTimeout>>()
  const touchStartPos = useRef({ x: 0, y: 0 })

  // Double-tap detection (landscape: toggle play/pause)
  const lastTapTime = useRef(0)
  const doubleTapTimer = useRef<ReturnType<typeof setTimeout>>()

  // Two-finger state: when active, all events bubble to LightBox
  const twoFingerActive = useRef(false)

  // Drag-to-seek state (landscape only)
  const seekBaseTime = useRef(0)
  const containerWidth = useRef(0)

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // Two-finger touch: let LightBox handle (context menu) — must check before stopPropagation
    if (e.touches.length >= 2) {
      twoFingerActive.current = true
      clearTimeout(longPressTimer.current)
      return
    }
    twoFingerActive.current = false

    if (isLandscape) {
      e.stopPropagation()
    }

    const touch = e.touches[0]
    touchStartTime.current = Date.now()
    touchMoved.current = false
    touchStartPos.current = { x: touch.clientX, y: touch.clientY }

    // Cache for drag-to-seek ratio calculation
    seekBaseTime.current = currentTime
    containerWidth.current = (e.currentTarget as HTMLElement).clientWidth || window.innerWidth

    if (touchArbiter) {
      // In landscape, LightBox's touchStart won't fire (stopPropagation),
      // so we must set pending here ourselves
      if (isLandscape && touchArbiter.current.gesture === 'idle') {
        touchArbiter.current.gesture = 'pending'
        touchArbiter.current.startTime = Date.now()
      }
      clearTimeout(longPressTimer.current)
      longPressTimer.current = setTimeout(() => {
        if (touchArbiter.current.gesture !== 'pending') return
        if (claimGesture(touchArbiter.current, 'speed_control')) {
          onSpeedPressStart(touchStartPos.current.x, touchStartPos.current.y)
        }
      }, 200)
    } else {
      onSpeedPressStart(touch.clientX, touch.clientY)
    }
  }, [isLandscape, onSpeedPressStart, touchArbiter, currentTime])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    // Two-finger: let LightBox handle
    if (e.touches.length >= 2) return

    if (isLandscape) {
      e.stopPropagation()
    }
    const touch = e.touches[0]

    if (touchArbiter) {
      const arbiter = touchArbiter.current
      if (arbiter.gesture === 'pending') {
        const dx = Math.abs(touch.clientX - touchStartPos.current.x)
        const dy = Math.abs(touch.clientY - touchStartPos.current.y)
        // Any horizontal movement cancels long-press speed control
        if (dx > 1) {
          clearTimeout(longPressTimer.current)
        }
        if (dx > 5 && dx > dy) {
          // Landscape: claim seeking; Portrait: let LightBox handle swiping
          if (isLandscape && duration > 0) {
            claimGesture(arbiter, 'seeking')
            onSeekingStart?.()
          }
        } else if (dy > 10) {
          clearTimeout(longPressTimer.current)
        }
        return
      }
      if (arbiter.gesture === 'seeking') {
        // Drag-to-seek: map horizontal delta to time
        // Sensitivity: full screen width = min(duration, 60s) for responsive feel
        const dx = touch.clientX - touchStartPos.current.x
        const seekRange = Math.min(duration, 600)
        const ratio = dx / containerWidth.current
        const newTime = Math.max(0, Math.min(duration, seekBaseTime.current + ratio * seekRange))
        onSeek(newTime)
        return
      }
      if (arbiter.gesture !== 'speed_control') return
      touchMoved.current = true
      onSpeedPressMove(touch.clientX, touch.clientY)
    } else {
      touchMoved.current = true
      onSpeedPressMove(touch.clientX, touch.clientY)
    }
  }, [isLandscape, onSpeedPressMove, touchArbiter, duration, onSeek])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    // Two-finger: let LightBox handle
    if (twoFingerActive.current) {
      if (e.touches.length === 0) twoFingerActive.current = false
      return
    }

    if (isLandscape) {
      e.stopPropagation()
    }
    clearTimeout(longPressTimer.current)
    const elapsed = Date.now() - touchStartTime.current

    if (touchArbiter) {
      const arbiter = touchArbiter.current

      if (arbiter.gesture === 'seeking') {
        onSeekingEnd?.()
        resetArbiter(arbiter)
        return
      }

      if (arbiter.gesture === 'speed_control') {
        onSpeedPressEnd()
        resetArbiter(arbiter)
        return
      }

      if (arbiter.gesture === 'pending') {
        if (!touchMoved.current && elapsed < 300) {
          const now = Date.now()
          if (isLandscape && now - lastTapTime.current < 300) {
            // Double tap in landscape → toggle play/pause
            clearTimeout(doubleTapTimer.current)
            lastTapTime.current = 0
            onClickPlayPause()
          } else {
            lastTapTime.current = now
            // Delay single tap to wait for possible double tap
            clearTimeout(doubleTapTimer.current)
            doubleTapTimer.current = setTimeout(() => {
              onTap()
              lastTapTime.current = 0
            }, isLandscape ? 300 : 0)
          }
        }
        resetArbiter(arbiter)
        return
      }
    } else {
      onSpeedPressEnd()
      if (!touchMoved.current && elapsed < 300) {
        onTap()
      }
    }
  }, [isLandscape, onSpeedPressEnd, onTap, touchArbiter])

  const handleNativeContextMenu = useCallback((e: React.MouseEvent) => {
    if (isMobile) {
      e.preventDefault()
      e.stopPropagation()
    }
  }, [isMobile])

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isMobile) {
      onClickPlayPause()
    }
  }, [isMobile, onClickPlayPause])

  return (
    <div
      className="absolute inset-0 z-[5]"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onClick={handleClick}
      onContextMenu={handleNativeContextMenu}
    />
  )
}
