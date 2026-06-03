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
