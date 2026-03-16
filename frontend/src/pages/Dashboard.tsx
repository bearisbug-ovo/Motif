import { useState, useEffect, useCallback } from 'react'
import {
  Server, Cpu, Monitor, AlertTriangle, RefreshCw,
  Play, Square, RotateCcw, HardDrive, Clock,
  ChevronDown, ChevronUp, Smartphone, Globe,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { confirm } from '@/components/ConfirmDialog'
import { launcherApi, type LauncherStatus } from '@/api/launcher'

/** Embeddable version for Settings tab */
export function DashboardContent() {
  const [status, setStatus] = useState<LauncherStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [showErrors, setShowErrors] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const [logs, setLogs] = useState<Record<string, string[]> | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const data = await launcherApi.getStatus()
      setStatus(data)
    } catch {
      // Backend might be down
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    const id = setInterval(fetchStatus, 5000)
    return () => clearInterval(id)
  }, [fetchStatus])

  const handleAction = async (action: string, fn: () => Promise<any>) => {
    setActionLoading(action)
    try {
      const result = await fn()
      if (result.detail) {
        toast({ title: result.detail, variant: 'destructive' })
      } else {
        toast({ title: `${action} 成功` })
      }
      setTimeout(fetchStatus, 2000)
    } catch (err: any) {
      toast({ title: `${action} 失败`, description: err.message, variant: 'destructive' })
    } finally {
      setActionLoading(null)
    }
  }

  const fetchLogs = async () => {
    try {
      const data = await launcherApi.getLogs(80)
      setLogs(data)
      setShowLogs(true)
    } catch {
      toast({ title: '获取日志失败', variant: 'destructive' })
    }
  }

  if (loading && !status) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="overflow-auto h-full px-6 py-6 pb-28 md:pb-4">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-end">
          <Button variant="ghost" size="sm" onClick={fetchStatus}>
            <RefreshCw className="w-4 h-4 mr-1.5" />
            刷新
          </Button>
        </div>

        {/* Service Status Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatusCard
            icon={<Server className="w-5 h-5" />}
            title="后端服务"
            connected={status?.backend.running ?? false}
            statusText={status?.backend.running ? '运行中' : '已停止'}
            details={[
              { label: '运行时间', value: status?.backend.uptime ?? '-' },
              { label: '版本', value: `v${status?.backend.version ?? '-'}` },
              { label: '端口', value: String(status?.backend.port ?? '-') },
              { label: 'PID', value: String(status?.backend.pid ?? '-') },
            ]}
            actions={
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                disabled={actionLoading === '重启后端'}
                onClick={async () => {
                  if (await confirm({ title: '确定要重启后端服务吗？', description: '页面将短暂不可用。' })) {
                    handleAction('重启后端', launcherApi.restartBackend)
                  }
                }}
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                重启后端
              </Button>
            }
          />

          <StatusCard
            icon={<Cpu className="w-5 h-5" />}
            title="ComfyUI"
            connected={status?.comfyui.connected ?? false}
            statusText={status?.comfyui.connected ? '已连接' : '未连接'}
            details={[
              { label: '地址', value: status?.comfyui.url ?? '-' },
              { label: '管理模式', value: status?.comfyui.managed ? '是' : '否' },
            ]}
            actions={
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  disabled={actionLoading !== null || (status?.comfyui.connected ?? false)}
                  onClick={() => handleAction('启动 ComfyUI', launcherApi.startComfyUI)}
                >
                  <Play className="w-3.5 h-3.5 mr-1" />
                  启动
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  disabled={actionLoading !== null}
                  onClick={() => handleAction('停止 ComfyUI', launcherApi.stopComfyUI)}
                >
                  <Square className="w-3.5 h-3.5 mr-1" />
                  停止
                </Button>
              </div>
            }
          />

          <StatusCard
            icon={<HardDrive className="w-5 h-5" />}
            title="存储空间"
            connected={true}
            statusText={status?.disk ? `可用 ${status.disk.free_gb} GB` : '-'}
            details={[
              { label: '总计', value: `${status?.disk.total_gb ?? '-'} GB` },
              { label: '已用', value: `${status?.disk.used_gb ?? '-'} GB` },
              { label: '可用', value: `${status?.disk.free_gb ?? '-'} GB` },
            ]}
            extra={status?.disk && (
              <div className="mt-2 bg-muted rounded-full h-2">
                <div
                  className={cn(
                    'rounded-full h-2 transition-all',
                    (status.disk.used_gb / status.disk.total_gb) > 0.9 ? 'bg-red-500' :
                    (status.disk.used_gb / status.disk.total_gb) > 0.7 ? 'bg-yellow-500' : 'bg-primary'
                  )}
                  style={{ width: `${(status.disk.used_gb / status.disk.total_gb) * 100}%` }}
                />
              </div>
            )}
          />
        </div>

        {/* Connected Devices */}
        <section className="rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Monitor className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">已连接设备</h2>
              <span className="text-xs bg-muted px-1.5 py-0.5 rounded-md">
                {status?.client_count ?? 0}
              </span>
            </div>
          </div>
          <div className="divide-y divide-border">
            {status?.clients && status.clients.length > 0 ? (
              status.clients.map((client) => (
                <div key={client.ip} className="flex items-center gap-3 px-4 py-2.5">
                  <DeviceIcon ua={client.user_agent} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono font-medium">{client.ip}</span>
                      <span className="text-xs text-muted-foreground">{client.user_agent}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs text-muted-foreground">{client.last_seen_ago}</div>
                    <div className="text-xs text-muted-foreground">{client.request_count} 请求</div>
                  </div>
                </div>
              ))
            ) : (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                暂无设备连接
              </div>
            )}
          </div>
        </section>

        {/* Error Stats */}
        <section className="rounded-lg border border-border bg-card">
          <button
            className="flex items-center justify-between w-full px-4 py-3 border-b border-border"
            onClick={() => setShowErrors(!showErrors)}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">错误统计</h2>
              {status?.errors && (
                <div className="flex gap-2">
                  <ErrorBadge label="1h" count={status.errors.last_1h} />
                  <ErrorBadge label="24h" count={status.errors.last_24h} />
                </div>
              )}
            </div>
            {showErrors ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {showErrors && (
            <div className="divide-y divide-border">
              {status?.errors.recent && status.errors.recent.length > 0 ? (
                status.errors.recent.map((err, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <span className={cn(
                      'font-mono text-xs px-1.5 py-0.5 rounded shrink-0',
                      err.status >= 500 ? 'bg-red-500/10 text-red-500' : 'bg-yellow-500/10 text-yellow-600'
                    )}>
                      {err.status}
                    </span>
                    <span className="text-xs text-muted-foreground w-12 shrink-0">{err.method}</span>
                    <span className="font-mono text-xs truncate flex-1">{err.path}</span>
                    {err.detail && (
                      <span className="text-xs text-muted-foreground truncate max-w-48">{err.detail}</span>
                    )}
                    <span className="text-xs text-muted-foreground shrink-0">{err.time_ago}</span>
                  </div>
                ))
              ) : (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  暂无错误记录
                </div>
              )}
            </div>
          )}
        </section>

        {/* Logs */}
        <section className="rounded-lg border border-border bg-card">
          <button
            className="flex items-center justify-between w-full px-4 py-3 border-b border-border"
            onClick={() => showLogs ? setShowLogs(false) : fetchLogs()}
          >
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">后端日志</h2>
            </div>
            {showLogs ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {showLogs && logs && (
            <div className="p-4 space-y-4 max-h-96 overflow-auto">
              {Object.entries(logs).map(([name, lines]) => (
                <div key={name}>
                  <h3 className="text-xs font-medium text-muted-foreground mb-2">{name}</h3>
                  <pre className="text-xs font-mono bg-muted/30 rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-all">
                    {lines.length > 0 ? lines.join('\n') : '(空)'}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}


// ── Sub-components ─────────────────────────────────────────────────────────

function StatusCard({
  icon, title, connected, statusText, details, actions, extra,
}: {
  icon: React.ReactNode
  title: string
  connected: boolean
  statusText: string
  details: { label: string; value: string }[]
  actions?: React.ReactNode
  extra?: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-semibold">{title}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={cn(
            'w-2 h-2 rounded-full',
            connected ? 'bg-green-500' : 'bg-red-500'
          )} />
          <span className={cn(
            'text-xs font-medium',
            connected ? 'text-green-600 dark:text-green-400' : 'text-red-500'
          )}>
            {statusText}
          </span>
        </div>
      </div>
      <div className="space-y-1">
        {details.map(({ label, value }) => (
          <div key={label} className="flex justify-between text-xs">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-mono">{value}</span>
          </div>
        ))}
      </div>
      {extra}
      {actions && <div className="pt-1">{actions}</div>}
    </div>
  )
}

function ErrorBadge({ label, count }: { label: string; count: number }) {
  return (
    <span className={cn(
      'text-xs px-1.5 py-0.5 rounded-md',
      count > 0 ? 'bg-red-500/10 text-red-500' : 'bg-muted text-muted-foreground'
    )}>
      {label}: {count}
    </span>
  )
}

function DeviceIcon({ ua }: { ua: string }) {
  const lower = ua.toLowerCase()
  if (lower.includes('iphone') || lower.includes('android mobile') || lower.includes('mobile')) {
    return <Smartphone className="w-4 h-4 text-muted-foreground shrink-0" />
  }
  if (lower.includes('api') || lower.includes('python') || lower.includes('httpx')) {
    return <Globe className="w-4 h-4 text-muted-foreground shrink-0" />
  }
  return <Monitor className="w-4 h-4 text-muted-foreground shrink-0" />
}
