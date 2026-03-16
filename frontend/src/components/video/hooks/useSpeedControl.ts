import { useState, useRef, useCallback } from 'react'

type SpeedState = 'idle' | 'speed_active' | 'locked'

interface SpeedControlResult {
  state: SpeedState
  rate: number
  shouldLock: boolean
  lockedRate: number | null

  /** Call on touchstart/mousedown */
  onPressStart: (x: number, y: number) => void
  /** Call on touchmove/mousemove during press */
  onPressMove: (x: number, y: number) => void
  /** Call on touchend/mouseup */
  onPressEnd: () => void
  /** Reset everything */
  reset: () => void
  /** Set rate directly (e.g. from speed selector) */
  setRate: (r: number) => void
  /** Clear locked state */
  clearLock: () => void
}

const LONG_PRESS_MS = 100
const SWIPE_PX_PER_STEP = 40
const STEP = 0.25
const MIN_RATE = 0.5
const MAX_RATE = 3
const LOCK_SWIPE_UP_PX = 30

export function useSpeedControl(onRateChange: (rate: number) => void): SpeedControlResult {
  const [state, setState] = useState<SpeedState>('idle')
  const [rate, setRateState] = useState(1)
  const [shouldLock, setShouldLock] = useState(false)
  const [lockedRate, setLockedRate] = useState<number | null>(null)

  const pressTimer = useRef<ReturnType<typeof setTimeout>>()
  const startPos = useRef({ x: 0, y: 0 })
  const baseRate = useRef(1)
  const currentRate = useRef(1)
  const isPressed = useRef(false)
  const didActivate = useRef(false)
  const shouldLockRef = useRef(false)

  const clampRate = (r: number) => {
    const clamped = Math.max(MIN_RATE, Math.min(MAX_RATE, Math.round(r / STEP) * STEP))
    return Number(clamped.toFixed(2))
  }

  const applyRate = useCallback((r: number) => {
    currentRate.current = r
    setRateState(r)
    onRateChange(r)
  }, [onRateChange])

  const onPressStart = useCallback((x: number, y: number) => {
    isPressed.current = true
    didActivate.current = false
    shouldLockRef.current = false
    setShouldLock(false)
    startPos.current = { x, y }

    pressTimer.current = setTimeout(() => {
      if (!isPressed.current) return
      didActivate.current = true
      setState('speed_active')

      // Start at 2x, or locked rate if in locked state
      const startRate = lockedRate ?? 2
      baseRate.current = startRate
      applyRate(startRate)
    }, LONG_PRESS_MS)
  }, [lockedRate, applyRate])

  const onPressMove = useCallback((x: number, y: number) => {
    if (!didActivate.current) {
      // Check if moved too far before activation → cancel
      const dx = Math.abs(x - startPos.current.x)
      const dy = Math.abs(y - startPos.current.y)
      if (dx > 10 || dy > 10) {
        clearTimeout(pressTimer.current)
        isPressed.current = false
      }
      return
    }

    // Horizontal: adjust speed
    const dx = x - startPos.current.x
    const steps = Math.round(dx / SWIPE_PX_PER_STEP)
    const newRate = clampRate(baseRate.current + steps * STEP)
    if (newRate !== currentRate.current) {
      applyRate(newRate)
    }

    // Vertical: up-swipe to lock
    const dy = startPos.current.y - y // positive = up
    if (dy > LOCK_SWIPE_UP_PX) {
      shouldLockRef.current = true
      setShouldLock(true)
    } else {
      shouldLockRef.current = false
      setShouldLock(false)
    }
  }, [applyRate])

  const onPressEnd = useCallback(() => {
    clearTimeout(pressTimer.current)
    isPressed.current = false

    if (!didActivate.current) {
      // Was not a long press
      return
    }

    if (shouldLockRef.current) {
      // Lock at current rate
      const locked = currentRate.current
      setLockedRate(locked)
      setState('locked')
      // Rate stays at locked value
    } else {
      // Restore to 1x
      applyRate(1)
      setState(lockedRate != null ? 'locked' : 'idle')
    }
    setShouldLock(false)
    didActivate.current = false
  }, [applyRate, lockedRate])

  const reset = useCallback(() => {
    clearTimeout(pressTimer.current)
    isPressed.current = false
    didActivate.current = false
    shouldLockRef.current = false
    setState('idle')
    setRateState(1)
    setShouldLock(false)
    setLockedRate(null)
    onRateChange(1)
  }, [onRateChange])

  const setRate = useCallback((r: number) => {
    const clamped = clampRate(r)
    applyRate(clamped)
    if (clamped === 1) {
      setLockedRate(null)
      setState('idle')
    } else {
      setLockedRate(clamped)
      setState('locked')
    }
  }, [applyRate])

  const clearLock = useCallback(() => {
    setLockedRate(null)
    setState('idle')
    applyRate(1)
  }, [applyRate])

  return {
    state,
    rate,
    shouldLock,
    lockedRate,
    onPressStart,
    onPressMove,
    onPressEnd,
    reset,
    setRate,
    clearLock,
  }
}
