import { cn } from '@/lib/utils'

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  )
}

/** Grid of skeleton cards matching the media/person/album grid layout */
export function SkeletonGrid({ count = 12, style }: { count?: number; style?: React.CSSProperties }) {
  return (
    <div style={style}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="aspect-square rounded-none sm:rounded-lg" />
      ))}
    </div>
  )
}

/** Empty state with icon, title and optional action */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
      <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center">
        <Icon className="w-8 h-8 opacity-40" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="text-xs text-muted-foreground/70">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
