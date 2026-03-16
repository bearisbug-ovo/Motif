import { useRef, useState, useCallback, useEffect, useImperativeHandle, forwardRef } from 'react'
import { cn } from '@/lib/utils'
import { VideoControls } from './VideoControls'
import { VideoGestureLayer } from './VideoGestureLayer'
import { SpeedIndicator } from './SpeedIndicator'
import { useControlsAutoHide } from './hooks/useControlsAutoHide'
import { useSpeedControl } from './hooks/useSpeedControl'
import type { TouchArbiter } from './hooks/useTouchArbiter'
import { isTouch } from '@/hooks/useDevice'

export interface VideoPlayerHandle {
  toggleMute: () => void
}

export interface VideoPlayerProps {
  src: string
  poster?: string
  autoPlay?: boolean
  initialMuted?: boolean
  initialTime?: number
  onMutedChange?: (muted: boolean) => void
  onProgressSave?: (time: number) => void
  onScreenshot?: (blob: Blob, timestamp: number) => void
  isLandscape: boolean
  onLandscapeChange: (landscape: boolean) => void
  touchArbiter?: React.MutableRefObject<TouchArbiter>
}

/**
 * Dual-video-element player: keeps two <video> stacked, swaps after first
 * frame of the new source is painted → no black flash between clips.
 */
export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(function VideoPlayer({
  src,
  poster,
  autoPlay = true,
  initialMuted = true,
  initialTime,
  onMutedChange,
  onProgressSave,
  onScreenshot,
  isLandscape,
  onLandscapeChange,
  touchArbiter,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null)

  // ── dual video slots ──
  const videoARef = useRef<HTMLVideoElement>(null)
  const videoBRef = useRef<HTMLVideoElement>(null)
  const [activeSlot, setActiveSlot] = useState<'A' | 'B'>('A')
  const activeSlotRef = useRef<'A' | 'B'>('A')

  /** Always returns the currently-visible video element */
  const getActive = useCallback(
    (): HTMLVideoElement | null =>
      activeSlotRef.current === 'A' ? videoARef.current : videoBRef.current,
    [],
  )

  // ── video state ──
  const [paused, setPaused] = useState(!autoPlay)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(initialMuted)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [videoError, setVideoError] = useState<string | null>(null)

  // Poster: shown only during initial load, dismissed once first frame paints
  const [showPoster, setShowPoster] = useState(!!poster)
  const posterDismissed = useRef(false)
  const [resumeHint, setResumeHint] = useState<string | null>(null)
  const wasPlayingBeforeSeek = useRef(false)

  // Controls auto-hide
  const [seekDragging] = useState(false)
  const controls = useControlsAutoHide({ locked: seekDragging })

  // Speed control
  const speedControl = useSpeedControl(
    useCallback(
      (rate: number) => {
        const v = getActive()
        if (v) v.playbackRate = rate
      },
      [getActive],
    ),
  )

  // ── initial mount: load first src on slot A ──
  const initialTimeApplied = useRef(false)
  useEffect(() => {
    const v = videoARef.current
    if (!v) return
    v.muted = initialMuted
    v.src = src
    // If we have a saved position, seek to it once metadata is ready
    if (initialTime && initialTime > 0 && !initialTimeApplied.current) {
      const onLoadedMeta = () => {
        if (!initialTimeApplied.current && v.duration > 0) {
          initialTimeApplied.current = true
          // Don't resume if within 3s of the end
          if (initialTime < v.duration - 3) {
            v.currentTime = initialTime
            // Show resume hint briefly
            const mins = Math.floor(initialTime / 60)
            const secs = Math.floor(initialTime % 60)
            setResumeHint(`从 ${mins}:${secs.toString().padStart(2, '0')} 继续播放`)
            setTimeout(() => setResumeHint(null), 2500)
          }
        }
        v.removeEventListener('loadedmetadata', onLoadedMeta)
      }
      v.addEventListener('loadedmetadata', onLoadedMeta)
    }
    if (autoPlay) v.play().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── src change: load on inactive slot, swap when ready ──
  const prevSrcRef = useRef(src)

  useEffect(() => {
    if (prevSrcRef.current === src) return // no change (includes mount)
    prevSrcRef.current = src
    setVideoError(null)

    const curSlot = activeSlotRef.current
    const activeVideo = curSlot === 'A' ? videoARef.current : videoBRef.current
    const inactiveVideo = curSlot === 'A' ? videoBRef.current : videoARef.current
    if (!activeVideo || !inactiveVideo) return

    // Copy playback settings
    inactiveVideo.muted = activeVideo.muted
    inactiveVideo.volume = activeVideo.volume
    inactiveVideo.playbackRate = activeVideo.playbackRate
    inactiveVideo.src = src

    let cancelled = false

    const doSwap = () => {
      if (cancelled) return
      activeVideo.pause()
      const next = curSlot === 'A' ? 'B' : 'A'
      activeSlotRef.current = next
      setActiveSlot(next)
    }

    // Play inactive video; swap after its first frame is painted
    inactiveVideo.play().then(() => {
      if (cancelled) return
      if ('requestVideoFrameCallback' in inactiveVideo) {
        ;(inactiveVideo as any).requestVideoFrameCallback(doSwap)
      } else {
        setTimeout(doSwap, 80)
      }
    }).catch(() => {
      // Autoplay blocked – swap anyway so user sees something
      if (!cancelled) doSwap()
    })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])

  // ── sync events from the active video ──
  useEffect(() => {
    const v = activeSlot === 'A' ? videoARef.current : videoBRef.current
    if (!v) return

    // Seed state from the now-active element
    setPaused(v.paused)
    setCurrentTime(v.currentTime)
    setDuration(v.duration || 0)
    setVolume(v.volume)
    setMuted(v.muted)
    if (v.buffered.length > 0) setBuffered(v.buffered.end(v.buffered.length - 1))

    const onPlay = () => {
      setPaused(false)
      // Dismiss poster once (initial load only)
      if (!posterDismissed.current && poster) {
        posterDismissed.current = true
        if ('requestVideoFrameCallback' in v) {
          ;(v as any).requestVideoFrameCallback(() => setShowPoster(false))
        } else {
          setTimeout(() => setShowPoster(false), 100)
        }
      }
      // Detect silent video track failure: audio plays but no video frames decode.
      // After 2s of "playing", if videoWidth is still 0 → video codec unsupported.
      setTimeout(() => {
        if (!v.paused && v.currentTime > 0 && v.videoWidth === 0) {
          setVideoError('视频轨解码失败：浏览器可能不支持该视频编码（如 HEVC/H.265），音频仍可正常播放')
        }
      }, 2000)
    }
    const onPause = () => setPaused(true)
    const onTimeUpdate = () => setCurrentTime(v.currentTime)
    const onDurationChange = () => setDuration(v.duration)
    const onProgress = () => {
      if (v.buffered.length > 0) setBuffered(v.buffered.end(v.buffered.length - 1))
    }
    const onVolumeChange = () => {
      setVolume(v.volume)
      setMuted(v.muted)
    }
    const onError = () => {
      const err = v.error
      if (!err) return
      const codeMap: Record<number, string> = {
        1: '视频加载已中止',
        2: '网络错误，无法加载视频',
        3: '视频解码失败（可能不支持该编码格式，如 HEVC/H.265 需安装解码器）',
        4: '不支持的视频格式',
      }
      setVideoError(codeMap[err.code] || `视频错误 (code ${err.code})`)
    }

    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('timeupdate', onTimeUpdate)
    v.addEventListener('durationchange', onDurationChange)
    v.addEventListener('progress', onProgress)
    v.addEventListener('volumechange', onVolumeChange)
    v.addEventListener('error', onError)

    return () => {
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('timeupdate', onTimeUpdate)
      v.removeEventListener('durationchange', onDurationChange)
      v.removeEventListener('progress', onProgress)
      v.removeEventListener('volumechange', onVolumeChange)
      v.removeEventListener('error', onError)
    }
  }, [activeSlot, poster])

  // Propagate muted prop
  useEffect(() => {
    const v = getActive()
    if (v) v.muted = initialMuted
  }, [initialMuted, getActive])

  // Fullscreen
  useEffect(() => {
    const h = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', h)
    return () => document.removeEventListener('fullscreenchange', h)
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const v = getActive()
      if (!v) return
      switch (e.key) {
        case ' ':
          e.preventDefault()
          v.paused ? v.play() : v.pause()
          break
        case 'ArrowLeft':
          e.preventDefault()
          v.currentTime = Math.max(0, v.currentTime - 5)
          break
        case 'ArrowRight':
          e.preventDefault()
          v.currentTime = Math.min(v.duration, v.currentTime + 5)
          break
        case 'ArrowUp':
          e.preventDefault()
          v.volume = Math.min(1, v.volume + 0.1)
          break
        case 'ArrowDown':
          e.preventDefault()
          v.volume = Math.max(0, v.volume - 0.1)
          break
        case 'f':
        case 'F':
          e.preventDefault()
          toggleFullscreen()
          break
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [getActive])

  // ── progress saving: periodic (15s), on pause, and on cleanup ──
  const lastSavedTime = useRef<number>(0)
  const currentTimeRef = useRef<number>(0)
  const durationRef = useRef<number>(0)

  // Keep refs in sync with state
  useEffect(() => { currentTimeRef.current = currentTime }, [currentTime])
  useEffect(() => { durationRef.current = duration }, [duration])

  // Capture onProgressSave per-src so cleanup saves to the correct item
  useEffect(() => {
    const saveFn = onProgressSave
    if (!saveFn) return
    lastSavedTime.current = 0

    const doSave = () => {
      const t = currentTimeRef.current
      const d = durationRef.current
      if (!d || d <= 0) return
      if (t >= d - 3) {
        if (lastSavedTime.current !== 0) {
          saveFn(0)
          lastSavedTime.current = 0
        }
        return
      }
      if (Math.abs(t - lastSavedTime.current) > 2) {
        saveFn(t)
        lastSavedTime.current = t
      }
    }

    const intervalId = setInterval(doSave, 15000)

    const onPauseForProgress = () => doSave()
    const v = getActive()
    v?.addEventListener('pause', onPauseForProgress)

    return () => {
      clearInterval(intervalId)
      v?.removeEventListener('pause', onPauseForProgress)
      doSave()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])

  // ── actions ──
  const handlePlayPause = useCallback(() => {
    const v = getActive()
    if (!v) return
    v.paused ? v.play() : v.pause()
  }, [getActive])

  const handleSeek = useCallback((time: number) => {
    const v = getActive()
    if (v) {
      v.currentTime = time
      setCurrentTime(time)
    }
  }, [getActive])

  const handleVolumeChange = useCallback((vol: number) => {
    const v = getActive()
    if (v) {
      v.volume = vol
      if (vol > 0 && v.muted) {
        v.muted = false
        onMutedChange?.(false)
      }
    }
  }, [getActive, onMutedChange])

  const handleMutedChange = useCallback((m: boolean) => {
    const v = getActive()
    if (v) {
      v.muted = m
      setMuted(m)
      onMutedChange?.(m)
    }
  }, [getActive, onMutedChange])

  useImperativeHandle(ref, () => ({
    toggleMute() {
      handleMutedChange(!muted)
    },
  }), [handleMutedChange, muted])

  const handleRateChange = useCallback((rate: number) => {
    const v = getActive()
    if (v) v.playbackRate = rate
    speedControl.setRate(rate)
  }, [getActive, speedControl])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else {
      containerRef.current?.requestFullscreen().catch(() => {})
    }
  }, [])

  const handleFrameStep = useCallback((dir: number) => {
    const v = getActive()
    if (!v) return
    v.pause()
    v.currentTime = Math.max(0, v.currentTime + dir / 30)
    controls.show() // Keep control bar visible while frame-stepping
  }, [getActive, controls])

  const handleScreenshot = useCallback(() => {
    const v = getActive()
    if (!v) return
    const timestamp = v.currentTime
    const canvas = document.createElement('canvas')
    canvas.width = v.videoWidth
    canvas.height = v.videoHeight
    canvas.getContext('2d')?.drawImage(v, 0, 0)
    canvas.toBlob((blob) => {
      if (blob) onScreenshot?.(blob, timestamp)
    }, 'image/png')
  }, [getActive, onScreenshot])

  // Click on letterbox bars (black area around video) should close LightBox.
  // Only stop propagation when click lands on the actual video content area.
  const handleVideoAreaClick = useCallback((e: React.MouseEvent) => {
    const v = getActive()
    if (!v || !v.videoWidth || !v.videoHeight) {
      e.stopPropagation()
      return
    }

    const rect = v.getBoundingClientRect()
    const videoRatio = v.videoWidth / v.videoHeight
    const elemRatio = rect.width / rect.height

    let contentLeft: number, contentTop: number, contentWidth: number, contentHeight: number
    if (elemRatio > videoRatio) {
      // Element wider than video → black bars on left/right
      contentHeight = rect.height
      contentWidth = rect.height * videoRatio
      contentLeft = rect.left + (rect.width - contentWidth) / 2
      contentTop = rect.top
    } else {
      // Element taller than video → black bars on top/bottom
      contentWidth = rect.width
      contentHeight = rect.width / videoRatio
      contentLeft = rect.left
      contentTop = rect.top + (rect.height - contentHeight) / 2
    }

    if (
      e.clientX >= contentLeft && e.clientX <= contentLeft + contentWidth &&
      e.clientY >= contentTop && e.clientY <= contentTop + contentHeight
    ) {
      e.stopPropagation() // on video content → don't close
    }
    // else: on letterbox bars → let bubble up to LightBox → close
  }, [getActive])

  const isMobile = isTouch
  const isOverlay = isLandscape || isFullscreen
  const controlsLayout = isOverlay ? ('overlay' as const) : ('bottom-bar' as const)

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative flex flex-col items-center w-full h-full',
      )}
      onMouseMove={controls.onMouseMove}
      onMouseEnter={controls.onMouseEnter}
      onMouseLeave={controls.onMouseLeave}
    >
      {/* Video area — dual videos stacked */}
      <div
        className={cn(
          'relative',
          isOverlay ? 'w-full h-full' : 'w-full flex-1',
        )}
        onClick={handleVideoAreaClick}
      >
        {/* Slot A */}
        <video
          ref={videoARef}
          className={cn(
            'absolute inset-0 w-full h-full object-contain',
            activeSlot === 'A' ? 'z-[1]' : 'z-0 invisible',
          )}
          playsInline
          preload="auto"
        />
        {/* Slot B */}
        <video
          ref={videoBRef}
          className={cn(
            'absolute inset-0 w-full h-full object-contain',
            activeSlot === 'B' ? 'z-[1]' : 'z-0 invisible',
          )}
          playsInline
          preload="auto"
        />
        {/* Poster — initial load only, dismissed after first frame */}
        {poster && showPoster && (
          <img
            src={poster}
            alt=""
            className="absolute inset-0 w-full h-full object-contain z-[2]"
          />
        )}
      </div>

      {/* Video error overlay */}
      {videoError && (
        <div className="absolute inset-0 z-[3] flex items-center justify-center bg-black/60 pointer-events-none">
          <div className="text-center px-6 max-w-md">
            <div className="text-white/90 text-sm font-medium mb-1">无法播放</div>
            <div className="text-white/60 text-xs">{videoError}</div>
          </div>
        </div>
      )}

      {/* Resume hint */}
      {resumeHint && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[4] bg-black/70 rounded-full px-4 py-1.5 pointer-events-none animate-fade-in-up">
          <span className="text-white/90 text-xs">{resumeHint}</span>
        </div>
      )}

      {/* Gesture layer (mobile) */}
      {isMobile && (
        <VideoGestureLayer
          isLandscape={isLandscape}
          onSpeedPressStart={speedControl.onPressStart}
          onSpeedPressMove={speedControl.onPressMove}
          onSpeedPressEnd={speedControl.onPressEnd}
          onTap={controls.onTap}
          onClickPlayPause={handlePlayPause}
          touchArbiter={touchArbiter}
          duration={duration}
          currentTime={currentTime}
          onSeek={handleSeek}
          onSeekingStart={() => {
            controls.show()
            const v = getActive()
            if (v && !v.paused) {
              wasPlayingBeforeSeek.current = true
              v.pause()
            } else {
              wasPlayingBeforeSeek.current = false
            }
          }}
          onSeekingEnd={() => {
            controls.hide()
            if (wasPlayingBeforeSeek.current) {
              const v = getActive()
              v?.play().catch(() => {})
            }
          }}
        />
      )}

      {/* Speed indicator */}
      <SpeedIndicator
        rate={speedControl.rate}
        isActive={speedControl.state === 'speed_active'}
        isLocked={speedControl.state === 'locked'}
        shouldLock={speedControl.shouldLock}
      />

      {/* Controls — hidden until video metadata loaded */}
      {duration > 0 && (
        <VideoControls
          paused={paused}
          currentTime={currentTime}
          duration={duration}
          buffered={buffered}
          volume={volume}
          muted={muted}
          rate={speedControl.rate}
          isFullscreen={isFullscreen}
          isLandscape={isLandscape}
          visible={controls.visible}
          onPlayPause={handlePlayPause}
          onSeek={handleSeek}
          onVolumeChange={handleVolumeChange}
          onMutedChange={handleMutedChange}
          onRateChange={handleRateChange}
          onFullscreenToggle={toggleFullscreen}
          onLandscapeToggle={() => onLandscapeChange(!isLandscape)}
          onFrameStep={handleFrameStep}
          onScreenshot={handleScreenshot}
          layout={controlsLayout}
          touchArbiter={touchArbiter}
        />
      )}
    </div>
  )
})
