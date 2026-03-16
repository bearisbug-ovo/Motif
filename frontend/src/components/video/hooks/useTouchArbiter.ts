import { useRef } from 'react'

export type TouchGesture = 'idle' | 'pending' | 'seeking' | 'swiping' | 'swiping_vertical' | 'speed_control'

export interface TouchArbiter {
  gesture: TouchGesture
  startTime: number
}

/**
 * Attempt to claim a gesture. Returns true if the claim succeeds
 * (i.e. the arbiter is currently in `pending` state, or already owns
 * the requested gesture).
 */
export function claimGesture(arbiter: TouchArbiter, desired: TouchGesture): boolean {
  if (arbiter.gesture === desired) return true
  if (arbiter.gesture === 'pending') {
    arbiter.gesture = desired
    return true
  }
  return false
}

export function resetArbiter(arbiter: TouchArbiter): void {
  arbiter.gesture = 'idle'
  arbiter.startTime = 0
}

export function useTouchArbiter() {
  return useRef<TouchArbiter>({ gesture: 'idle', startTime: 0 })
}
