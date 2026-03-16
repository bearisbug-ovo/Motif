import { useSyncExternalStore } from 'react'

/** Touch-capable device (doesn't change at runtime) */
export const isTouch: boolean =
  typeof window !== 'undefined' &&
  ('ontouchstart' in window || navigator.maxTouchPoints > 0)

/** Responsive breakpoint: viewport < 768px */
function subscribeWidth(cb: () => void) {
  window.addEventListener('resize', cb)
  return () => window.removeEventListener('resize', cb)
}
function getIsMobile() {
  return typeof window !== 'undefined' && window.innerWidth < 768
}

/**
 * Unified device detection hook.
 * - `isMobile`: responsive layout breakpoint (< 768px), updates on resize
 * - `isTouch`: static, true if device supports touch input
 */
export function useDevice() {
  const isMobile = useSyncExternalStore(subscribeWidth, getIsMobile, () => false)
  return { isMobile, isTouch }
}
