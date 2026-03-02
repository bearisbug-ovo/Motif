import { NavLink } from 'react-router-dom'
import { Users, Trash2, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSystemStore } from '@/stores/system'
import { useEffect } from 'react'

const navItems = [
  { to: '/', icon: Users, label: '人物库' },
  { to: '/recycle-bin', icon: Trash2, label: '回收站' },
  { to: '/settings', icon: Settings, label: '设置' },
]

export function Sidebar() {
  const { status, fetchStatus } = useSystemStore()

  useEffect(() => {
    fetchStatus()
    const id = setInterval(fetchStatus, 10000)
    return () => clearInterval(id)
  }, [fetchStatus])

  return (
    <aside className="flex flex-col w-16 hover:w-48 transition-all duration-200 h-screen bg-card border-r border-border overflow-hidden group shrink-0">
      {/* Logo */}
      <div className="flex items-center h-14 px-4 border-b border-border shrink-0">
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
          <span className="text-primary-foreground font-bold text-sm">M</span>
        </div>
        <span className="ml-3 font-bold text-foreground opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
          Motif
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 space-y-1 px-2">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center h-10 rounded-md px-2 gap-3 transition-colors text-sm',
                isActive
                  ? 'bg-primary/20 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )
            }
          >
            <Icon className="w-5 h-5 shrink-0" />
            <span className="opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* ComfyUI status dot */}
      <div className="px-3 py-4 border-t border-border flex items-center gap-2">
        <div
          className={cn(
            'w-2 h-2 rounded-full shrink-0',
            status?.comfyui.connected ? 'bg-green-500' : 'bg-red-500'
          )}
        />
        <span className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
          ComfyUI {status?.comfyui.connected ? '已连接' : '未连接'}
        </span>
      </div>
    </aside>
  )
}
