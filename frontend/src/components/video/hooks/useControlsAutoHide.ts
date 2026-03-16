import { useState, useRef, useCallback, useEffect } from 'react'
import { isTouch } from '@/hooks/useDevice'

interface UseControlsAutoHideOptions {
  /** Hide delay in ms (default 3000) */
  delay?: number
  /** Whether controls are locked visible (e.g. during drag) */
  locked?: boolean
}

export function useControlsAutoHide({ delay = 3000, locked = false }: UseControlsAutoHideOptions = {}) {
  const [visible, setVisible] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const isMobile = useRef(isTouch)

  const resetTimer = useCallback(() => {
    if (locked) return
    clearTimeout(timer.current)
    setVisible(true)
    timer.current = setTimeout(() => setVisible(false), delay)
  }, [delay, locked])

  // PC: mouse move resets timer
  const onMouseMove = useCallback(() => {
    if (!isMobile.current) resetTimer()
  }, [resetTimer])

  // Mobile: tap toggles
  const onTap = useCallback(() => {
    if (isMobile.current) {
      setVisible(v => !v)
      clearTimeout(timer.current)
    }
  }, [])

  // Show controls initially, start hide timer
  const onMouseEnter = useCallback(() => {
    if (!isMobile.current) resetTimer()
  }, [resetTimer])

  const onMouseLeave = useCallback(() => {
    if (!isMobile.current) {
      clearTimeout(timer.current)
      setVisible(false)
    }
  }, [])

  // Force show (e.g. during seeking)
  const show = useCallback(() => {
    clearTimeout(timer.current)
    setVisible(true)
  }, [])

  // Force hide
  const hide = useCallback(() => {
    clearTimeout(timer.current)
    setVisible(false)
  }, [])

  useEffect(() => {
    if (locked) {
      clearTimeout(timer.current)
      setVisible(true)
    }
  }, [locked])

  useEffect(() => () => clearTimeout(timer.current), [])

  return { visible, onMouseMove, onMouseEnter, onMouseLeave, onTap, show, hide, resetTimer }
}
