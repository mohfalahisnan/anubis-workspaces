import type { CSSProperties, ReactNode } from 'react'
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react'

export interface RoutedEdgeData {
  sourceOffset: number
  targetOffset: number
  hasSourceSiblings: boolean
  hasTargetSiblings: boolean
}

interface EdgeShape {
  id: string
  source: string
  target: string
  data?: Record<string, unknown>
}

const GAP_PX = 42

function getCenteredOffset(index: number, total: number, gap = GAP_PX): number {
  if (total <= 1) return 0
  return (index - (total - 1) / 2) * gap
}

function groupEdgeIdsByKey<T extends EdgeShape>(
  edges: readonly T[],
  keyName: 'source' | 'target',
): Record<string, string[]> {
  const groups: Record<string, string[]> = {}
  for (const edge of edges) {
    const key = edge[keyName]
    const current = groups[key] ?? []
    current.push(edge.id)
    groups[key] = current
  }
  return groups
}

export function applyVisualEdgeRouting<T extends EdgeShape>(
  edges: readonly T[],
): (T & { data: T['data'] & RoutedEdgeData })[] {
  const sourceGroups = groupEdgeIdsByKey(edges, 'source')
  const targetGroups = groupEdgeIdsByKey(edges, 'target')

  return edges.map((edge) => {
    const sourceGroup = sourceGroups[edge.source] ?? []
    const targetGroup = targetGroups[edge.target] ?? []
    const sourceIndex = Math.max(sourceGroup.indexOf(edge.id), 0)
    const targetIndex = Math.max(targetGroup.indexOf(edge.id), 0)
    const sourceOffset = getCenteredOffset(sourceIndex, sourceGroup.length)
    const targetOffset = getCenteredOffset(targetIndex, targetGroup.length)

    return {
      ...edge,
      data: {
        ...(edge.data ?? {}),
        sourceOffset,
        targetOffset,
        hasSourceSiblings: sourceGroup.length > 1,
        hasTargetSiblings: targetGroup.length > 1,
      },
    } as T & { data: T['data'] & RoutedEdgeData }
  })
}

const KEYFRAMES = `@keyframes workflowLineDash { from { stroke-dashoffset: 18; } to { stroke-dashoffset: 0; } }`

export const workflowEdgeDefaults = {
  animated: true,
  type: 'separated' as const,
  style: {
    strokeWidth: 2,
    stroke: 'rgba(255, 255, 255, 0.78)',
    strokeDasharray: '10 8',
    animation: 'workflowLineDash 900ms linear infinite',
  } satisfies CSSProperties,
} as const

export const workflowEdgeLabelDefaults = {
  labelBgPadding: [8, 4] as [number, number],
  labelBgBorderRadius: 8,
  labelStyle: { fill: '#ffffff', fontSize: 11, fontWeight: 600 },
  labelBgStyle: { fill: 'rgba(11, 11, 12, 0.94)', stroke: 'rgba(253, 85, 29, 0.24)' },
}

type SeparatedEdgeData = Partial<RoutedEdgeData> & Record<string, unknown>

export function SeparatedEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  label,
  data,
}: EdgeProps) {
  const routed = (data ?? {}) as SeparatedEdgeData
  const sourceOffset = routed.hasSourceSiblings ? routed.sourceOffset ?? 0 : 0
  const targetOffset = routed.hasTargetSiblings ? routed.targetOffset ?? 0 : 0
  const visualSourceY = sourceY + sourceOffset
  const visualTargetY = targetY + targetOffset
  const distance = Math.max(Math.abs(targetX - sourceX), 160)
  const controlDistance = Math.min(Math.max(distance * 0.42, 120), 320)
  const labelX = (sourceX + targetX) / 2
  const labelY = (visualSourceY + visualTargetY) / 2

  const edgePath = [
    `M ${sourceX},${visualSourceY}`,
    `C ${sourceX + controlDistance},${visualSourceY} ${targetX - controlDistance},${visualTargetY} ${targetX},${visualTargetY}`,
  ].join(' ')

  return (
    <>
      <style>{KEYFRAMES}</style>
      <BaseEdge id={id} path={edgePath} markerEnd={undefined} style={style} />
      {label != null ? (
        <EdgeLabelRenderer>
          <div
            className='nodrag nopan absolute rounded-lg border border-[#fd551d]/25 bg-[#0b0b0c]/95 px-2 py-1 text-[11px] font-semibold text-white shadow-lg shadow-black/30'
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {label as ReactNode}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}
