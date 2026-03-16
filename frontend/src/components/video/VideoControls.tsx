import { useState, useRef, useCallback, useEffect } from 'react'
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  SkipBack, SkipForward, Camera, ChevronDown,
  RotateCcw, MoreHorizontal,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { TouchArbiter, claimGesture, resetArbiter } from './hooks/useTouchArbiter'
import { isTouch } from '@/hooks/useDevice'

interface VideoControlsProps {
  // State
  paused: boolean
  currentTime: number
  duration: number
  buffered: number
  volume: number
  muted: boolean
  rate: number
  isFullscreen: boolean
  isLandscape: boolean
  visible: boolean

  // Actions
  onPlayPause: () => void
  onSeek: (time: number) => void
  onVolumeChange: (vol: number) => void
  onMutedChange: (muted: boolean) => void
  onRateChange: (rate: number) => void
  onFullscreenToggle: () => void
  onLandscapeToggle: () => void
  onFrameStep: (dir: number) => void
  onScreenshot: () => void

  // Layout hint
  layout: 'bottom-bar' | 'overlay'

  // Touch arbiter (shared with LightBox)
  touchArbiter?: React.MutableRefObject<TouchArbiter>
}

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function VideoControls({
  paused, currentTime, duration, buffered, volume, muted, rate,
  isFullscreen, isLandscape, visible,
  onPlayPause, onSeek, onVolumeChange, onMutedChange, onRateChange,
  onFullscreenToggle, onLandscapeToggle, onFrameStep, onScreenshot,
  layout, touchArbiter,
}: VideoControlsProps) {
  const [seeking, setSeeking] = useState(false)
  const seekingRef = useRef(false)
  const [seekValue, setSeekValue] = useState(0)
  const [showSpeedMenu, setShowSpeedMenu] = useState(false)
  const [showVolumeSlider, setShowVolumeSlider] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const progressRef = useRef<HTMLDivElement>(null)
  const volumeRef = useRef<HTMLDivElement>(null)
  const speedMenuRef = useRef<HTMLDivElement>(null)
  const moreMenuRef = useRef<HTMLDivElement>(null)

  const progress = duration > 0 ? (seeking ? seekValue : currentTime) / duration : 0
  const bufferedProgress = duration > 0 ? buffered / duration : 0
  const isMobile = isTouch

  // Close speed menu on click outside
  useEffect(() => {
    if (!showSpeedMenu) return
    const handler = (e: MouseEvent) => {
      if (speedMenuRef.current && !speedMenuRef.current.contains(e.target as Node)) {
        setShowSpeedMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showSpeedMenu])

  // Close more menu on click outside
  useEffect(() => {
    if (!showMoreMenu) return
    const handler = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showMoreMenu])

  // Progress bar seek
  const getSeekPosition = useCallback((clientX: number) => {
    if (!progressRef.current) return 0
    const rect = progressRef.current.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  }, [])

  const handleProgressPointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation()

    // Claim seeking gesture via arbiter (blocks swipe + speed control)
    if (touchArbiter) {
      claimGesture(touchArbiter.current, 'seeking')
    }

    const pos = getSeekPosition(e.clientX)
    seekingRef.current = true
    setSeeking(true)
    setSeekValue(pos * duration)
    onSeek(pos * duration)

    // Use document-level listeners for drag (avoids React pointer capture issues)
    const onMove = (ev: PointerEvent) => {
      const p = getSeekPosition(ev.clientX)
      setSeekValue(p * duration)
      onSeek(p * duration)
    }
    const onUp = (ev: PointerEvent) => {
      const p = getSeekPosition(ev.clientX)
      onSeek(p * duration)
      seekingRef.current = false
      setSeeking(false)
      if (touchArbiter) {
        resetArbiter(touchArbiter.current)
      }
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }, [getSeekPosition, duration, onSeek, touchArbiter])

  // Volume slider
  const handleVolumePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!volumeRef.current) return
    const rect = volumeRef.current.getBoundingClientRect()
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    onVolumeChange(pos)
    if (muted) onMutedChange(false)
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [onVolumeChange, muted, onMutedChange])

  const handleVolumePointerMove = useCallback((e: React.PointerEvent) => {
    if (!volumeRef.current) return
    const rect = volumeRef.current.getBoundingClientRect()
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    onVolumeChange(pos)
  }, [onVolumeChange])

  const isOverlay = layout === 'overlay'

  return (
    <div
      className={cn(
        'transition-opacity duration-200 select-none z-10',
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none',
        isOverlay
          ? 'absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent pt-12 pb-3 px-4'
          : 'relative w-full bg-black/60 rounded-lg px-4 py-2.5 mt-2'
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Progress bar */}
      <div
        ref={progressRef}
        className="group relative h-7 flex items-center cursor-pointer touch-none"
        onPointerDown={handleProgressPointerDown}
      >
        <div className="w-full h-1 group-hover:h-2 transition-all bg-white/20 rounded-full relative">
          {/* Buffered */}
          <div
            className="absolute inset-y-0 left-0 bg-white/30 rounded-full pointer-events-none"
            style={{ width: `${bufferedProgress * 100}%` }}
          />
          {/* Progress */}
          <div
            className="absolute inset-y-0 left-0 bg-primary rounded-full pointer-events-none"
            style={{ width: `${progress * 100}%` }}
          />
          {/* Thumb */}
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 bg-primary rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow pointer-events-none"
            style={{ left: `${progress * 100}%` }}
          />
        </div>
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-2 mt-0.5">
        {/* Play/Pause */}
        <button
          onClick={onPlayPause}
          className="p-1.5 hover:bg-white/10 rounded text-white/80 hover:text-white transition-colors"
        >
          {paused ? <Play className="w-6 h-6" /> : <Pause className="w-6 h-6" />}
        </button>

        {/* Volume */}
        <div
          className="flex items-center gap-1 group/vol"
          onMouseEnter={() => setShowVolumeSlider(true)}
          onMouseLeave={() => setShowVolumeSlider(false)}
        >
          <button
            onClick={() => onMutedChange(!muted)}
            className="p-1.5 hover:bg-white/10 rounded text-white/80 hover:text-white transition-colors"
          >
            {muted || volume === 0 ? (
              <VolumeX className="w-5 h-5" />
            ) : (
              <Volume2 className="w-5 h-5" />
            )}
          </button>
          {/* Volume slider (PC only, hover to show) */}
          {!isMobile && (
            <div
              ref={volumeRef}
              className={cn(
                'w-16 h-4 flex items-center cursor-pointer transition-all touch-none',
                showVolumeSlider ? 'opacity-100 w-16' : 'opacity-0 w-0 overflow-hidden'
              )}
              onPointerDown={handleVolumePointerDown}
              onPointerMove={handleVolumePointerMove}
            >
              <div className="w-full h-1 bg-white/20 rounded-full relative">
                <div
                  className="absolute inset-y-0 left-0 bg-white/80 rounded-full pointer-events-none"
                  style={{ width: `${(muted ? 0 : volume) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Time */}
        <span className="text-sm text-white/60 tabular-nums whitespace-nowrap ml-1">
          {formatTime(seeking ? seekValue : currentTime)} / {formatTime(duration)}
        </span>

        <div className="flex-1" />

        {isMobile ? (
          <>
            {/* More menu (mobile) */}
            <div className="relative" ref={moreMenuRef}>
              <button
                onClick={() => setShowMoreMenu(v => !v)}
                className="p-1.5 hover:bg-white/10 rounded text-white/80 hover:text-white transition-colors"
              >
                <MoreHorizontal className="w-5 h-5" />
              </button>
              {showMoreMenu && (
                <div className="absolute bottom-full right-0 mb-1 bg-black/90 backdrop-blur-sm border border-white/10 rounded-lg py-1 min-w-[7rem] z-20">
                  {/* Speed sub-options */}
                  <div className="px-3 py-1.5 text-xs text-white/50">倍速</div>
                  <div className="flex flex-wrap gap-1 px-3 pb-1.5">
                    {SPEED_OPTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => { onRateChange(s); setShowMoreMenu(false) }}
                        className={cn(
                          'px-2 py-1 rounded text-xs tabular-nums transition-colors',
                          rate === s ? 'bg-primary text-primary-foreground' : 'text-white/80 hover:bg-white/10'
                        )}
                      >
                        {s}x
                      </button>
                    ))}
                  </div>
                  <div className="h-px bg-white/10 mx-2 my-1" />
                  <button
                    onClick={() => { onFrameStep(-1); setShowMoreMenu(false) }}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-white/80 hover:bg-white/10 transition-colors"
                  >
                    <SkipBack className="w-4 h-4" /> 上一帧
                  </button>
                  <button
                    onClick={() => { onFrameStep(1); setShowMoreMenu(false) }}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-white/80 hover:bg-white/10 transition-colors"
                  >
                    <SkipForward className="w-4 h-4" /> 下一帧
                  </button>
                  <button
                    onClick={() => { onScreenshot(); setShowMoreMenu(false) }}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-white/80 hover:bg-white/10 transition-colors"
                  >
                    <Camera className="w-4 h-4" /> 截图
                  </button>
                </div>
              )}
            </div>

            {/* Landscape/fullscreen toggle (mobile) */}
            <button
              onClick={onLandscapeToggle}
              className="p-1.5 hover:bg-white/10 rounded text-white/80 hover:text-white transition-colors"
              title={isLandscape ? '竖屏' : '横屏'}
            >
              {isLandscape ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
            </button>
          </>
        ) : (
          <>
            {/* Speed selector (PC) */}
            <div className="relative" ref={speedMenuRef}>
              <button
                onClick={() => setShowSpeedMenu(v => !v)}
                className="flex items-center gap-0.5 px-2 py-1.5 hover:bg-white/10 rounded text-sm text-white/80 hover:text-white transition-colors"
              >
                <span className="tabular-nums">{rate === 1 ? '1x' : `${rate}x`}</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              {showSpeedMenu && (
                <div className="absolute bottom-full right-0 mb-1 bg-black/90 backdrop-blur-sm border border-white/10 rounded-lg py-1 min-w-[5rem] z-20">
                  {SPEED_OPTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => { onRateChange(s); setShowSpeedMenu(false) }}
                      className={cn(
                        'block w-full text-left px-3 py-1.5 text-sm hover:bg-white/10 transition-colors tabular-nums',
                        rate === s ? 'text-primary' : 'text-white/80'
                      )}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Frame step back */}
            <button
              onClick={() => onFrameStep(-1)}
              className="p-1.5 hover:bg-white/10 rounded text-white/80 hover:text-white transition-colors"
              title="上一帧"
            >
              <SkipBack className="w-5 h-5" />
            </button>

            {/* Frame step forward */}
            <button
              onClick={() => onFrameStep(1)}
              className="p-1.5 hover:bg-white/10 rounded text-white/80 hover:text-white transition-colors"
              title="下一帧"
            >
              <SkipForward className="w-5 h-5" />
            </button>

            {/* Screenshot */}
            <button
              onClick={onScreenshot}
              className="p-1.5 hover:bg-white/10 rounded text-white/80 hover:text-white transition-colors"
              title="截图"
            >
              <Camera className="w-5 h-5" />
            </button>

            {/* Fullscreen (PC) */}
            <button
              onClick={onFullscreenToggle}
              className="p-1.5 hover:bg-white/10 rounded text-white/80 hover:text-white transition-colors"
              title={isFullscreen ? '退出全屏' : '全屏'}
            >
              {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
