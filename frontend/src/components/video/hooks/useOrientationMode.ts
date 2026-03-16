import { useState, useCallback, useEffect } from 'react'

export function useOrientationMode() {
  const [isLandscape, setIsLandscape] = useState(false)

  // Listen to orientation changes
  useEffect(() => {
    const handleChange = () => {
      if (screen.orientation) {
        setIsLandscape(screen.orientation.type.startsWith('landscape'))
      }
    }

    if (screen.orientation) {
      screen.orientation.addEventListener('change', handleChange)
      return () => screen.orientation.removeEventListener('change', handleChange)
    }
  }, [])

  const toggleLandscape = useCallback(async () => {
    const next = !isLandscape

    if (next) {
      // Many mobile browsers require fullscreen before orientation lock
      try {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen()
        }
      } catch {
        // fullscreen not supported
      }
      try {
        const orientation = screen.orientation as any
        if (orientation?.lock) {
          await orientation.lock('landscape')
        }
      } catch {
        // orientation lock not supported (desktop), just toggle state
      }
    } else {
      // Unlock orientation and exit fullscreen
      try {
        const orientation = screen.orientation as any
        if (orientation?.unlock) {
          orientation.unlock()
        }
      } catch {
        // ignore
      }
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen()
        }
      } catch {
        // ignore
      }
    }

    setIsLandscape(next)
  }, [isLandscape])

  return { isLandscape, setIsLandscape, toggleLandscape }
}
