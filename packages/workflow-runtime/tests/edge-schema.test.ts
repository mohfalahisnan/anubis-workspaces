import { describe, it, expect } from 'vitest'
import { WorkflowEdgeSchema, WorkflowGraphSchema } from '../src/types.js'

describe('WorkflowEdgeSchema', () => {
  it('preserves sourceHandle and data.loop', () => {
    const e = WorkflowEdgeSchema.parse({
      id: 'e1', source: 'a', target: 'b', sourceHandle: 'rejected', data: { loop: true },
    })
    expect(e.sourceHandle).toBe('rejected')
    expect(e.data?.loop).toBe(true)
  })

  it('still accepts a minimal edge', () => {
    const e = WorkflowEdgeSchema.parse({ id: 'e1', source: 'a', target: 'b' })
    expect(e.sourceHandle).toBeUndefined()
    expect(e.data).toBeUndefined()
  })

  it('graph parse keeps the new edge fields', () => {
    const g = WorkflowGraphSchema.parse({
      nodes: [{ id: 'a', type: 'table', position: { x: 0, y: 0 }, data: {} },
              { id: 'b', type: 'table', position: { x: 1, y: 0 }, data: {} }],
      edges: [{ id: 'e1', source: 'a', target: 'b', sourceHandle: 'approved' }],
    })
    expect(g.edges[0]!.sourceHandle).toBe('approved')
  })
})
