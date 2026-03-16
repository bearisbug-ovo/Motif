import { useState, useEffect, useCallback } from 'react'
import { NavLink } from 'react-router-dom'
import { Users, Settings, ListTodo, Wrench, Zap, Loader2, Maximize, Minimize } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTaskStore } from '@/stores/task'

const navItems = [
  { to: '/', icon: Users, label: '人物库' },
  { to: '/tasks', icon: ListTodo, label: '任务', badge: true },
  { to: '/workflows', icon: Zap, label: '工作流' },
  { to: '/tools', icon: Wrench, label: '小工具' },
  { to: '/settings', icon: Settings, label: '设置' },
]

export function BottomNav() {
  const { stats } = useTaskStore()
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement)

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch {}
  }, [])

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 bg-card border-t border-border flex items-center justify-around h-14 md:hidden">
      {navItems.map(({ to, icon: Icon, label, badge }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            cn(
              'flex flex-col items-center gap-0.5 py-1 px-3 text-xs transition-colors',
              isActive ? 'text-primary' : 'text-muted-foreground'
            )
          }
        >
          <div className="relative">
            <Icon className="w-5 h-5" />
            {badge && stats && <BottomBadge stats={stats} />}
          </div>
        </NavLink>
      ))}
      {/* Fullscreen toggle */}
      {document.fullscreenEnabled && (
        <button
          onClick={toggleFullscreen}
          className="flex flex-col items-center gap-0.5 py-1 px-3 text-xs text-muted-foreground transition-colors"
        >
          {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
        </button>
      )}
    </nav>
  )
}

function BottomBadge({ stats }: { stats: { running: number; pending: number; failed: number; completed_since_last_view: number } }) {
  if (stats.running > 0) {
    return (
      <span className="absolute -top-1 -right-1.5">
        <Loader2 className="w-3 h-3 text-blue-500 animate-spin" />
      </span>
    )
  }
  if (stats.pending > 0) {
    return (
      <span className="absolute -top-1 -right-1.5 w-3.5 h-3.5 rounded-full bg-blue-500 text-white text-[10px] flex items-center justify-center font-bold">
        {stats.pending > 9 ? '9+' : stats.pending}
      </span>
    )
  }
  if (stats.failed > 0) {
    return (
      <span className="absolute -top-1 -right-1.5 w-3.5 h-3.5 rounded-full bg-destructive text-white text-[10px] flex items-center justify-center font-bold">
        {stats.failed > 9 ? '9+' : stats.failed}
      </span>
    )
  }
  if (stats.completed_since_last_view > 0) {
    return (
      <span className="absolute -top-1 -right-1.5 w-3.5 h-3.5 rounded-full bg-green-500 text-white text-[10px] flex items-center justify-center font-bold">
        {stats.completed_since_last_view > 9 ? '9+' : stats.completed_since_last_view}
      </span>
    )
  }
  return null
}
