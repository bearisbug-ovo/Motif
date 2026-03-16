import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X, Check, Play, Pause, SkipBack, SkipForward } from 'lucide-react'
import { MediaItem, mediaApi } from '@/api/media'
import { Button } from '@/components/ui/button'
import { ResultDestination } from './ResultDestination'

export interface TrimSaveOptions {
  precise: boolean
  personId?: string | null
  albumId?: string | null
  linkParent?: boolean
}

interface VideoTrimEditorProps {
  open: boolean
  onClose: () => void
  media: MediaItem | null
  onComplete: (start: number, end: number, options: TrimSaveOptions) => void
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 10)
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}.${ms}` : `${s}.${ms}s`
}

export function VideoTrimEditor({ open, onClose, media, onComplete }: VideoTrimEditorProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [duration, setDuration] = useState(0)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [precise, setPrecise] = useState(false)
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null)

  // Destination state
  const [targetPersonId, setTargetPersonId] = useState<string | null>(null)
  const [targetAlbumId, setTargetAlbumId] = useState<string | null>(null)
  const [linkParent, setLinkParent] = useState(false)

  useEffect(() => {
    if (open && media) {
      setStart(0)
      setEnd(0)
      setCurrentTime(0)
      setPlaying(false)
      setPrecise(false)
      setDragging(null)
      setTargetPersonId(media.person_id ?? null)
      setTargetAlbumId(media.album_id ?? null)
      setLinkParent(false)
    }
  }, [open, media])

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      if (e.key === ' ') { e.preventDefault(); togglePlay() }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, playing])

  const onLoadedMetadata = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    const d = video.duration
    setDuration(d)
    setEnd(d)
  }, [])

  const onTimeUpdate = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    setCurrentTime(video.currentTime)
    // Stop at end handle
    if (video.currentTime >= end && end > 0) {
      video.pause()
      setPlaying(false)
    }
  }, [end])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      if (video.currentTime >= end || video.currentTime < start) {
        video.currentTime = start
      }
      video.play()
      setPlaying(true)
    } else {
      video.pause()
      setPlaying(false)
    }
  }, [start, end])

  const seekTo = useCallback((time: number) => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = time
    setCurrentTime(time)
  }, [])

  const getTimeFromPosition = useCallback((clientX: number) => {
    const track = trackRef.current
    if (!track || duration === 0) return 0
    const rect = track.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return ratio * duration
  }, [duration])

  const handlePointerDown = useCallback((handle: 'start' | 'end', e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(handle)
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return
    const time = getTimeFromPosition(e.clientX)
    if (dragging === 'start') {
      const newStart = Math.min(time, end - 0.1)
      setStart(Math.max(0, newStart))
      seekTo(Math.max(0, newStart))
    } else {
      const newEnd = Math.max(time, start + 0.1)
      setEnd(Math.min(duration, newEnd))
    }
  }, [dragging, start, end, duration, getTimeFromPosition, seekTo])

  const handlePointerUp = useCallback(() => {
    setDragging(null)
  }, [])

  const handleConfirm = useCallback(() => {
    onComplete(start, end, {
      precise,
      personId: targetPersonId,
      albumId: targetAlbumId,
      linkParent,
    })
  }, [start, end, precise, onComplete, targetPersonId, targetAlbumId, linkParent])

  if (!open || !media) return null

  const selectedDuration = end - start
  const startPct = duration > 0 ? (start / duration) * 100 : 0
  const endPct = duration > 0 ? (end / duration) * 100 : 100
  const currentPct = duration > 0 ? (currentTime / duration) * 100 : 0

  return createPortal(
    <div
      className="fixed inset-0 z-[60] bg-black/95 flex flex-col select-none"
      onClick={(e) => e.stopPropagation()}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/80 border-b border-white/10">
        <span className="text-white/70 text-sm">
          已选择: {formatTime(selectedDuration)}
          <span className="text-white/40 ml-3">
            {formatTime(start)} — {formatTime(end)}
          </span>
        </span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="text-white/70 hover:text-white" onClick={() => seekTo(start)}>
            <SkipBack className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="sm" className="text-white/70 hover:text-white" onClick={togglePlay}>
            {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
          </Button>
          <Button variant="ghost" size="sm" className="text-white/70 hover:text-white" onClick={() => seekTo(end)}>
            <SkipForward className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Video preview */}
      <div className="flex-1 flex items-center justify-center overflow-hidden p-4 min-h-0">
        <video
          ref={videoRef}
          src={mediaApi.serveUrl(media.file_path)}
          className="max-h-full max-w-full object-contain"
          onLoadedMetadata={onLoadedMetadata}
          onTimeUpdate={onTimeUpdate}
          playsInline
          muted
        />
      </div>

      {/* Timeline */}
      <div className="px-6 py-4 bg-black/80">
        <div
          ref={trackRef}
          className="relative h-10 bg-white/10 rounded-lg cursor-pointer"
          onClick={(e) => {
            if (dragging) return
            const time = getTimeFromPosition(e.clientX)
            seekTo(time)
          }}
        >
          {/* Selected range */}
          <div
            className="absolute top-0 bottom-0 bg-primary/30 rounded"
            style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
          />

          {/* Current position */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-white z-10 pointer-events-none"
            style={{ left: `${currentPct}%` }}
          />

          {/* Start handle */}
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-20 touch-none"
            style={{ left: `${startPct}%` }}
            onPointerDown={(e) => handlePointerDown('start', e)}
          >
            <div className="w-5 h-10 bg-primary rounded-md flex items-center justify-center cursor-ew-resize hover:bg-primary/80 transition-colors"
              style={{ minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <div className="w-5 h-10 bg-primary rounded-md flex items-center justify-center">
                <div className="w-0.5 h-4 bg-white/60 rounded" />
              </div>
            </div>
          </div>

          {/* End handle */}
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-20 touch-none"
            style={{ left: `${endPct}%` }}
            onPointerDown={(e) => handlePointerDown('end', e)}
          >
            <div className="w-5 h-10 bg-primary rounded-md flex items-center justify-center cursor-ew-resize hover:bg-primary/80 transition-colors"
              style={{ minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <div className="w-5 h-10 bg-primary rounded-md flex items-center justify-center">
                <div className="w-0.5 h-4 bg-white/60 rounded" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Result destination */}
      <div className="px-4 py-1 bg-black/80 border-t border-white/10">
        <div className="[&_*]:text-white/70 [&_button]:bg-white/10 [&_button]:hover:bg-white/20 [&_button]:border-white/10">
          <ResultDestination
            personId={targetPersonId}
            albumId={targetAlbumId}
            onLocationChange={(pid, aid) => { setTargetPersonId(pid); setTargetAlbumId(aid) }}
            linkParent={linkParent}
            onLinkParentChange={setLinkParent}
          />
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/80 border-t border-white/10">
        <Button variant="ghost" className="text-white/70 hover:text-white" onClick={onClose}>
          <X className="w-4 h-4 mr-1" />
          取消
        </Button>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-white/70 cursor-pointer">
            <input
              type="checkbox"
              checked={precise}
              onChange={(e) => setPrecise(e.target.checked)}
              className="rounded border-white/30"
            />
            精确裁剪 (重编码)
          </label>
          <Button
            onClick={handleConfirm}
            disabled={selectedDuration < 0.1}
            className="gap-1"
          >
            <Check className="w-4 h-4" />
            保存
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
