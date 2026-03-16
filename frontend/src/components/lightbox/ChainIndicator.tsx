import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { mediaApi, MediaItem } from '@/api/media'
import { useLightboxStore } from '@/stores/lightbox'
import { cn } from '@/lib/utils'

const WORKFLOW_LABELS: Record<string, string> = {
  upscale: '高清放大',
  face_swap: '换脸',
  inpaint_flux: '局部修复',
  inpaint_sdxl: '局部修复',
  inpaint_klein: '局部修复',
  image_to_image: '图生图',
  text_to_image: '文生图',
  preprocess: '预处理',
}

const WORKFLOW_COLORS: Record<string, string> = {
  upscale: 'border-blue-400',
  face_swap: 'border-purple-400',
  inpaint_flux: 'border-amber-400',
  inpaint_sdxl: 'border-amber-400',
  inpaint_klein: 'border-amber-400',
  screenshot: 'border-green-400',
  local: 'border-gray-400',
  generated: 'border-cyan-400',
}

const WORKFLOW_BG: Record<string, string> = {
  upscale: 'bg-blue-400/15',
  face_swap: 'bg-purple-400/15',
  inpaint_flux: 'bg-amber-400/15',
  inpaint_sdxl: 'bg-amber-400/15',
  inpaint_klein: 'bg-amber-400/15',
  screenshot: 'bg-green-400/15',
  local: 'bg-gray-400/15',
  generated: 'bg-cyan-400/15',
}

const WORKFLOW_LINE: Record<string, string> = {
  upscale: 'border-blue-400/40',
  face_swap: 'border-purple-400/40',
  inpaint_flux: 'border-amber-400/40',
  inpaint_sdxl: 'border-amber-400/40',
  inpaint_klein: 'border-amber-400/40',
  screenshot: 'border-green-400/40',
  local: 'border-gray-400/40',
  generated: 'border-cyan-400/40',
}

/** A node positioned in the horizontal tree layout */
interface LayoutNode {
  item: MediaItem
  depth: number       // column (0 = root)
  row: number         // row position
  childRows: number[] // rows of direct children (for drawing lines)
  label: string
  colorKey: string
}

/**
 * Build a flat layout array from the chain tree.
 * Horizontal axis = depth, vertical axis = DFS row (siblings sorted by created_at).
 * Returns nodes positioned on a (depth, row) grid.
 */
function buildTreeLayout(
  rootItem: MediaItem | undefined,
  tree: { id: string; children: any[]; [k: string]: unknown } | null,
): LayoutNode[] {
  if (!tree || !rootItem) return []

  const nodes: LayoutNode[] = []
  let nextRow = 0

  function walk(node: any, depth: number): number {
    const item = depth === 0 ? rootItem! : node as unknown as MediaItem
    const wf = (node.workflow_type as string) || (node.source_type as string) || ''

    // Build label: check chain_history for multi-step chain results
    let label: string
    if (depth === 0) {
      label = '原图'
    } else {
      const genParams = node.generation_params as Record<string, any> | null
      const chainHistory = genParams?.chain_history as { workflow_type: string; category?: string }[] | undefined
      if (chainHistory && chainHistory.length > 1) {
        // Show all chain step labels: "换脸→高清放大"
        label = chainHistory.map(step => {
          const cat = step.category || ''
          return WORKFLOW_LABELS[cat] || cat || ''
        }).filter(Boolean).join('→')
      } else {
        label = WORKFLOW_LABELS[wf] || wf || ''
      }
    }

    const myIndex = nodes.length
    const myRow = nextRow++

    nodes.push({
      item,
      depth,
      row: myRow,
      childRows: [],
      label,
      colorKey: wf || 'local',
    })

    const children = (node.children || []) as any[]
    for (const child of children) {
      const childRow = walk(child, depth + 1)
      nodes[myIndex].childRows.push(childRow)
    }

    return myRow
  }

  walk(tree, 0)
  return nodes
}

// Cell dimensions for the tree grid
const CELL_W = 56  // px per column
const CELL_H = 52  // px per row
const NODE_SIZE = 40 // thumbnail size
const HALF_NODE = NODE_SIZE / 2

interface ChainIndicatorProps {
  onContextMenu?: (e: React.MouseEvent, item: MediaItem) => void
}

export function ChainIndicator({ onContextMenu }: ChainIndicatorProps) {
  const {
    chainTree, chainFlat, chainIndex, currentItem, localItems, localIndex,
    navigateV, jumpTo,
  } = useLightboxStore()
  const [expanded, setExpanded] = useState(false)
  const expandedRef = useRef<HTMLDivElement>(null)

  const rootItem = localItems[localIndex]
  const layout = useMemo(
    () => buildTreeLayout(rootItem, chainTree),
    [rootItem?.id, chainTree],
  )

  // Auto-scroll to current node in expanded view
  useEffect(() => {
    if (!expanded || !expandedRef.current || !currentItem) return
    const active = expandedRef.current.querySelector('[data-chain-active="true"]')
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [expanded, currentItem?.id])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation()
    if (e.deltaY > 0) navigateV(1)
    else if (e.deltaY < 0) navigateV(-1)
  }, [navigateV])

  // Hide when no chain data or no descendants
  if (!chainTree || chainFlat.length === 0) return null

  const currentId = currentItem?.id

  // Build flat display for collapsed strip: root + all chain items
  const allNodes = [
    { item: rootItem, type: rootItem?.source_type || 'local', wf: rootItem?.workflow_type },
    ...chainFlat.map(m => ({ item: m, type: m.source_type, wf: m.workflow_type })),
  ]

  if (!expanded) {
    // Collapsed: single-line horizontal strip
    return (
      <div
        className="shrink-0 border-t border-white/10 px-4 py-1.5 flex items-center gap-1.5 overflow-x-auto"
        onClick={(e) => e.stopPropagation()}
        onWheel={handleWheel}
      >
        {allNodes.map((node, i) => {
          if (!node.item) return null
          const isCurrent = node.item.id === currentId
          const colorClass = WORKFLOW_COLORS[node.wf || node.type] || 'border-gray-500'
          return (
            <div key={node.item.id} className="flex items-center gap-1.5 shrink-0">
              {i > 0 && <span className="text-white/20 text-xs">›</span>}
              <button
                className={cn(
                  'w-8 h-8 rounded overflow-hidden border-2 transition-all shrink-0',
                  isCurrent ? `${colorClass} opacity-100 ring-1 ring-primary` : `${colorClass} opacity-40 hover:opacity-70`
                )}
                onClick={() => jumpTo(node.item.id)}
                onContextMenu={(e) => {
                  if (onContextMenu) {
                    jumpTo(node.item.id)
                    onContextMenu(e, node.item)
                  }
                }}
              >
                <img
                  src={mediaApi.itemThumbUrl(node.item, 80)}
                  alt=""
                  className="w-full h-full object-cover"
                />
              </button>
            </div>
          )
        })}

        <button
          className="ml-1 p-0.5 rounded hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors shrink-0"
          onClick={() => setExpanded(true)}
          title="展开生成链"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>
    )
  }

  // Expanded: horizontal tree layout
  const maxDepth = layout.reduce((m, n) => Math.max(m, n.depth), 0)
  const maxRow = layout.reduce((m, n) => Math.max(m, n.row), 0)
  const gridW = (maxDepth + 1) * CELL_W + 16
  const gridH = (maxRow + 1) * CELL_H

  return (
    <div className="shrink-0 relative">
      {/* Backdrop to close */}
      <div className="fixed inset-0 z-20" onClick={(e) => { e.stopPropagation(); setExpanded(false) }} />
      {/* Floating panel above this element */}
      <div
        ref={expandedRef}
        className="absolute left-4 right-4 bottom-full mb-2 z-30 bg-black/90 backdrop-blur-sm border border-white/15 rounded-lg shadow-2xl max-h-[280px] overflow-auto"
        onClick={(e) => e.stopPropagation()}
        onWheel={handleWheel}
      >
        {/* Header */}
        <div className="sticky top-0 bg-black/90 backdrop-blur-sm flex items-center justify-between px-3 py-2 border-b border-white/10 z-10">
          <span className="text-xs font-medium text-white/50">生成链 · {chainFlat.length} 个衍生</span>
          <button
            className="p-0.5 rounded hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors"
            onClick={() => setExpanded(false)}
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
        </div>
        {/* Horizontal tree */}
        <div className="p-2">
          <div className="relative" style={{ width: gridW, height: gridH }}>
            {/* Connection lines (SVG) */}
            <svg
              className="absolute inset-0 pointer-events-none"
              width={gridW}
              height={gridH}
            >
              {layout.map((node) => {
                if (node.childRows.length === 0) return null
                const parentX = node.depth * CELL_W + 8 + HALF_NODE
                const parentY = node.row * CELL_H + (CELL_H - NODE_SIZE) / 2 + HALF_NODE
                const lineColor = WORKFLOW_LINE[node.colorKey] ? undefined : undefined
                // Use a subtle color derived from the node
                const strokeColor = 'rgba(255,255,255,0.15)'

                return node.childRows.map((childRow, ci) => {
                  const childX = (node.depth + 1) * CELL_W + 8
                  const childY = childRow * CELL_H + (CELL_H - NODE_SIZE) / 2 + HALF_NODE
                  const midX = parentX + (childX - parentX) / 2

                  return (
                    <path
                      key={`${node.item.id}-${ci}`}
                      d={`M ${parentX} ${parentY} C ${midX} ${parentY}, ${midX} ${childY}, ${childX} ${childY}`}
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth={1.5}
                    />
                  )
                })
              })}
            </svg>

            {/* Nodes */}
            {layout.map((node) => {
              const isCurrent = node.item.id === currentId
              const colorClass = WORKFLOW_COLORS[node.colorKey] || 'border-gray-500'
              const bgClass = WORKFLOW_BG[node.colorKey] || 'bg-gray-400/15'
              const x = node.depth * CELL_W + 8
              const y = node.row * CELL_H + (CELL_H - NODE_SIZE) / 2

              return (
                <button
                  key={node.item.id}
                  data-chain-active={isCurrent ? 'true' : undefined}
                  className={cn(
                    'absolute rounded overflow-hidden border-2 transition-all',
                    isCurrent
                      ? `${colorClass} opacity-100 ring-2 ring-primary shadow-lg shadow-primary/30`
                      : `${colorClass} opacity-50 hover:opacity-80`
                  )}
                  style={{
                    left: x,
                    top: y,
                    width: NODE_SIZE,
                    height: NODE_SIZE,
                  }}
                  onClick={() => jumpTo(node.item.id)}
                  onContextMenu={(e) => {
                    if (onContextMenu) {
                      jumpTo(node.item.id)
                      onContextMenu(e, node.item)
                    }
                  }}
                  title={node.label}
                >
                  <img
                    src={mediaApi.itemThumbUrl(node.item, 80)}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                  {/* Small label badge */}
                  {node.depth > 0 && (
                    <div className={cn(
                      'absolute bottom-0 left-0 right-0 text-[8px] leading-tight text-center text-white/80 py-px truncate',
                      bgClass,
                    )}>
                      {node.label}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>
      {/* Collapsed strip placeholder (keeps space, shows current state) */}
      <div
        className="border-t border-white/10 px-4 py-1.5 flex items-center gap-1.5 overflow-x-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {allNodes.map((node, i) => {
          if (!node.item) return null
          const isCurrent = node.item.id === currentId
          const colorClass = WORKFLOW_COLORS[node.wf || node.type] || 'border-gray-500'
          return (
            <div key={node.item.id} className="flex items-center gap-1.5 shrink-0">
              {i > 0 && <span className="text-white/20 text-xs">›</span>}
              <button
                className={cn(
                  'w-8 h-8 rounded overflow-hidden border-2 transition-all shrink-0',
                  isCurrent ? `${colorClass} opacity-100 ring-1 ring-primary` : `${colorClass} opacity-40 hover:opacity-70`
                )}
                onClick={() => jumpTo(node.item.id)}
                onContextMenu={(e) => {
                  if (onContextMenu) {
                    jumpTo(node.item.id)
                    onContextMenu(e, node.item)
                  }
                }}
              >
                <img
                  src={mediaApi.itemThumbUrl(node.item, 80)}
                  alt=""
                  className="w-full h-full object-cover"
                />
              </button>
            </div>
          )
        })}
        <button
          className="ml-1 p-0.5 rounded hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors shrink-0"
          onClick={() => setExpanded(false)}
          title="收起生成链"
        >
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
