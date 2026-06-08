import { describe, it, expect } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { wouldCreateCycle } from '@/components/workflow-editor/editor-canvas'

const node = (id: string): Node => ({ id, type: 'table', position: { x: 0, y: 0 }, data: {} })

describe('wouldCreateCycle', () => {
  it('ignores existing loop edges when checking a new forward connection', () => {
    const nodes = ['improve', 'draft', 'review', 'human', 'lesson'].map(node)
    const edges: Edge[] = [
      { id: 'e-improve-draft', source: 'improve', target: 'draft' },
      { id: 'e-draft-review', source: 'draft', target: 'review' },
      { id: 'e-human-lesson', source: 'human', target: 'lesson' },
      { id: 'e-lesson-loop', source: 'lesson', target: 'improve', data: { loop: true } },
    ] as Edge[]

    expect(wouldCreateCycle(nodes, edges, { source: 'review', target: 'human' })).toBe(false)
    expect(wouldCreateCycle(
      nodes,
      [...edges, { id: 'e-review-human', source: 'review', target: 'human' }],
      { source: 'lesson', target: 'improve' },
    )).toBe(true)
  })
})
