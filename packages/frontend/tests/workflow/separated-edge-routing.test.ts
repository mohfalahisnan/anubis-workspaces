import { describe, it, expect } from 'vitest'

import { applyVisualEdgeRouting } from '@/components/workflow/separated-edge'

interface FlowEdgeLike {
  id: string
  source: string
  target: string
}

describe('applyVisualEdgeRouting', () => {
  it('returns 0 offsets for edges with no siblings', () => {
    const edges: FlowEdgeLike[] = [
      { id: 'e1', source: 'a', target: 'b' },
    ]
    const routed = applyVisualEdgeRouting(edges)
    expect(routed[0].data).toMatchObject({
      sourceOffset: 0,
      targetOffset: 0,
      hasSourceSiblings: false,
      hasTargetSiblings: false,
    })
  })

  it('centers offsets symmetrically around 0 for shared targets', () => {
    const edges: FlowEdgeLike[] = [
      { id: 'e1', source: 'a', target: 'z' },
      { id: 'e2', source: 'b', target: 'z' },
      { id: 'e3', source: 'c', target: 'z' },
    ]
    const routed = applyVisualEdgeRouting(edges)
    const targetOffsets = routed.map((e) => e.data.targetOffset)
    // 3 edges, gap 42 → (i - 1) * 42 → [-42, 0, 42]
    expect(targetOffsets).toEqual([-42, 0, 42])
    expect(routed.every((e) => e.data.hasTargetSiblings)).toBe(true)
    expect(routed.every((e) => e.data.hasSourceSiblings === false)).toBe(true)
  })

  it('flags fan-out from a shared source', () => {
    const edges: FlowEdgeLike[] = [
      { id: 'e1', source: 's', target: 'a' },
      { id: 'e2', source: 's', target: 'b' },
    ]
    const routed = applyVisualEdgeRouting(edges)
    expect(routed.map((e) => e.data.sourceOffset)).toEqual([-21, 21])
    expect(routed.every((e) => e.data.hasSourceSiblings)).toBe(true)
    expect(routed.every((e) => e.data.hasTargetSiblings === false)).toBe(true)
  })

  it('preserves all other edge fields untouched', () => {
    const edges = [{ id: 'e1', source: 'a', target: 'b', label: 'hello', extra: 42 } as never]
    const routed = applyVisualEdgeRouting(edges) as readonly { label: string; extra: number }[]
    expect(routed[0].label).toBe('hello')
    expect(routed[0].extra).toBe(42)
  })
})
