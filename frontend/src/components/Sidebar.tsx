import { NavLink } from 'react-router-dom'
import { Users, Settings, ListTodo, Wrench, Zap, Loader2, Maximize, Minimize } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSystemStore } from '@/stores/system'
import { useTaskStore } from '@/stores/task'
import { useEffect, useState, useCallback } from 'react'

const navItems = [
  { to: '/', icon: Users, label: '人物库' },
  { to: '/tasks', icon: ListTodo, label: '任务队列', badge: true },
  { to: '/workflows', icon: Zap, label: '工作流' },
  { to: '/tools', icon: Wrench, label: '小工具' },
  { to: '/settings', icon: Settings, label: '设置' },
]

export function Sidebar() {
  const { status, fetchStatus } = useSystemStore()
  const { stats, startPolling, stopPolling } = useTaskStore()

  useEffect(() => {
    fetchStatus()
    const id = setInterval(fetchStatus, 10000)
    return () => clearInterval(id)
  }, [fetchStatus])

  useEffect(() => {
    startPolling()
    return () => stopPolling()
  }, [startPolling, stopPolling])

  return (
    <aside data-testid="sidebar" className="hidden md:flex flex-col w-44 h-screen bg-card border-r border-border shrink-0">
      {/* Logo */}
      <div className="flex items-center h-14 px-4 border-b border-border shrink-0">
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
          <span className="text-primary-foreground font-bold text-sm">M</span>
        </div>
        <span className="ml-3 font-bold text-foreground whitespace-nowrap">
          Motif
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 space-y-1 px-2">
        {navItems.map(({ to, icon: Icon, label, badge }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            data-testid={`nav-${label}`}
            className={({ isActive }) =>
              cn(
                'flex items-center h-10 rounded-md px-2 gap-3 transition-colors text-sm',
                isActive
                  ? 'bg-primary/20 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )
            }
          >
            <div className="relative shrink-0">
              <Icon className="w-5 h-5" />
              {badge && stats && <TaskBadge stats={stats} />}
            </div>
            <span className="whitespace-nowrap">{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Fullscreen toggle */}
      {document.fullscreenEnabled && <FullscreenToggle />}

      {/* ComfyUI status dot */}
      <div className="px-3 py-4 border-t border-border flex items-center gap-2">
        <div
          className={cn(
            'w-2 h-2 rounded-full shrink-0',
            status?.comfyui.connected ? 'bg-green-500' : 'bg-red-500'
          )}
        />
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          ComfyUI {status?.comfyui.connected ? '已连接' : '未连接'}
        </span>
      </div>
    </aside>
  )
}

function FullscreenToggle() {
  const [isFs, setIsFs] = useState(!!document.fullscreenElement)

  useEffect(() => {
    const onChange = () => setIsFs(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggle = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch {}
  }, [])

  return (
    <button
      onClick={toggle}
      className="flex items-center h-10 rounded-md px-2 gap-3 mx-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
    >
      {isFs ? <Minimize className="w-5 h-5 shrink-0" /> : <Maximize className="w-5 h-5 shrink-0" />}
      <span className="whitespace-nowrap">
        {isFs ? '退出全屏' : '全屏'}
      </span>
    </button>
  )
}

function TaskBadge({ stats }: { stats: { running: number; pending: number; failed: number; completed_since_last_view: number } }) {
  if (stats.running > 0) {
    return (
      <span data-testid="task-badge-running" className="absolute -top-1 -right-1.5 flex items-center justify-center">
        <Loader2 className="w-3 h-3 text-blue-500 animate-spin" />
      </span>
    )
  }
  if (stats.pending > 0) {
    return (
      <span data-testid="task-badge-pending" className="absolute -top-1 -right-1.5 w-3.5 h-3.5 rounded-full bg-blue-500 text-white text-[10px] flex items-center justify-center font-bold">
        {stats.pending > 9 ? '9+' : stats.pending}
      </span>
    )
  }
  if (stats.failed > 0) {
    return (
      <span data-testid="task-badge-failed" className="absolute -top-1 -right-1.5 w-3.5 h-3.5 rounded-full bg-destructive text-white text-[10px] flex items-center justify-center font-bold">
        {stats.failed > 9 ? '9+' : stats.failed}
      </span>
    )
  }
  if (stats.completed_since_last_view > 0) {
    return (
      <span data-testid="task-badge-completed" className="absolute -top-1 -right-1.5 w-3.5 h-3.5 rounded-full bg-green-500 text-white text-[10px] flex items-center justify-center font-bold">
        {stats.completed_since_last_view > 9 ? '9+' : stats.completed_since_last_view}
      </span>
    )
  }
  return null
}
