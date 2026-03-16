import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight } from 'lucide-react'

interface ContextMenuPortalProps {
  position: { x: number; y: number }
  onClose: () => void
  children: React.ReactNode
}

export function ContextMenuPortal({ position, onClose, children }: ContextMenuPortalProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  // Adjust position to keep menu within viewport
  useEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.right > window.innerWidth) {
      el.style.left = `${window.innerWidth - rect.width - 8}px`
    }
    if (rect.bottom > window.innerHeight) {
      el.style.top = `${window.innerHeight - rect.height - 8}px`
    }
  }, [])

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleMenuClose = () => onClose()
    // Use capture to close before other handlers fire
    document.addEventListener('mousedown', handle, true)
    document.addEventListener('contextmenu', handle, true)
    document.addEventListener('motif-menu-close', handleMenuClose)
    return () => {
      document.removeEventListener('mousedown', handle, true)
      document.removeEventListener('contextmenu', handle, true)
      document.removeEventListener('motif-menu-close', handleMenuClose)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[200] bg-popover border border-border rounded-md shadow-lg py-1 min-w-[160px] text-sm"
      style={{ left: position.x, top: position.y }}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body
  )
}

/* Reusable menu item primitives */

interface MenuItemProps {
  icon?: React.ReactNode
  label: string
  onClick: () => void
  destructive?: boolean
}

export function MenuItem({ icon, label, onClick, destructive }: MenuItemProps) {
  return (
    <button
      className={`w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-accent ${
        destructive ? 'text-destructive hover:text-destructive' : ''
      }`}
      onClick={() => {
        onClick()
        // Auto-close: dispatch a custom event that ContextMenuPortal listens for
        document.dispatchEvent(new CustomEvent('motif-menu-close'))
      }}
    >
      {icon}
      {label}
    </button>
  )
}

export function MenuSeparator() {
  return <div className="h-px bg-border my-1" />
}

/* Submenu item — hover to expand a child menu panel */

interface SubMenuItemProps {
  icon?: React.ReactNode
  label: string
  children: React.ReactNode
  disabled?: boolean
}

export function SubMenuItem({ icon, label, children, disabled }: SubMenuItemProps) {
  const [open, setOpen] = useState(false)
  const parentRef = useRef<HTMLDivElement>(null)
  const subRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  const show = () => { clearTimeout(timerRef.current); setOpen(true) }
  const hide = () => { timerRef.current = setTimeout(() => setOpen(false), 150) }

  // Position submenu: on mobile (narrow screens) use fixed positioning
  // to avoid clipping; on desktop use relative right/left positioning.
  const [useFixed, setUseFixed] = useState(false)
  const [fixedPos, setFixedPos] = useState({ left: 0, top: 0 })

  useEffect(() => {
    if (!open) return
    const parent = parentRef.current
    const sub = subRef.current
    if (!parent || !sub) return
    const pr = parent.getBoundingClientRect()
    const sw = sub.offsetWidth
    const sh = sub.offsetHeight
    const isMobile = window.innerWidth < 640

    if (isMobile) {
      // Fixed positioning: center-ish horizontally, clamp vertically
      const left = Math.max(8, Math.min(pr.left, window.innerWidth - sw - 8))
      const top = Math.max(8, Math.min(pr.bottom + 2, window.innerHeight - sh - 8))
      setFixedPos({ left, top })
      setUseFixed(true)
      // Reset any relative styles
      sub.style.left = ''
      sub.style.top = ''
    } else {
      setUseFixed(false)
      // Horizontal: prefer right, fallback left
      if (pr.right + sw + 4 <= window.innerWidth) {
        sub.style.left = `${pr.width - 2}px`
      } else {
        sub.style.left = `${-sw + 2}px`
      }
      // Vertical: align top with parent, clamp to viewport
      const top = Math.min(0, window.innerHeight - pr.top - sh - 8)
      sub.style.top = `${top}px`
    }
  }, [open])

  if (disabled) return null

  return (
    <div
      ref={parentRef}
      className="relative"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <button
        className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-accent"
        onClick={show}
      >
        {icon}
        <span className="flex-1">{label}</span>
        <ChevronRight className="w-3 h-3 text-muted-foreground" />
      </button>
      {open && (
        <div
          ref={subRef}
          className={`${useFixed ? 'fixed' : 'absolute'} z-[201] bg-popover border border-border rounded-md shadow-lg py-1 min-w-[140px] text-sm`}
          style={useFixed ? { left: fixedPos.left, top: fixedPos.top } : undefined}
          onMouseEnter={show}
          onMouseLeave={hide}
        >
          {children}
        </div>
      )}
    </div>
  )
}
