import { describe, it, expect } from 'vitest'
import { partitionWorkflowEdges, topologicalSort, validateGraphStructure, outgoingEdges } from '../src/graph.js'
import type { WorkflowGraph } from '../src/types.js'

const G: WorkflowGraph = {
  nodes: [
    { id: 'a', type: 't', position: { x: 0, y: 0 }, data: {} },
    { id: 'b', type: 't', position: { x: 0, y: 0 }, data: {} },
    { id: 'c', type: 't', position: { x: 0, y: 0 }, data: {} },
  ],
  edges: [
    { id: 'e1', source: 'a', target: 'b' },
    { id: 'e2', source: 'a', target: 'c' },
  ],
}

describe('outgoingEdges', () => {
  it('returns target ids of edges sourced at the node', () => {
    expect(outgoingEdges(G, 'a').sort()).toEqual(['b', 'c'])
  })

  it('returns [] for a leaf node', () => {
    expect(outgoingEdges(G, 'b')).toEqual([])
  })

  it('returns [] for an unknown node', () => {
    expect(outgoingEdges(G, 'missing')).toEqual([])
  })
})

function g(nodes: string[], edges: Array<[string, string]>): WorkflowGraph {
  return {
    nodes: nodes.map((id) => ({ id, type: 'table', position: { x: 0, y: 0 }, data: {} })),
    edges: edges.map(([s, t], i) => ({ id: `e${i}`, source: s, target: t })),
  }
}

describe('topologicalSort', () => {
  it('returns sources first for a linear chain', () => {
    const order = topologicalSort(g(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']]))
    expect(order).toEqual(['a', 'b', 'c'])
  })

  it('keeps both branches before sink in a diamond', () => {
    const order = topologicalSort(g(['a', 'b', 'c', 'd'], [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd']]))
    expect(order[0]).toBe('a')
    expect(order[3]).toBe('d')
    expect(order.slice(1, 3).sort()).toEqual(['b', 'c'])
  })

  it('throws on cycle', () => {
    expect(() => topologicalSort(g(['a', 'b'], [['a', 'b'], ['b', 'a']])))
      .toThrowError(/cycle/i)
  })
})

describe('validateGraphStructure', () => {
  it('rejects edges that reference missing nodes', () => {
    expect(() => validateGraphStructure(g(['a'], [['a', 'b']])))
      .toThrowError(/edge.*references missing node/i)
  })

  it('rejects duplicate node ids', () => {
    const bad: WorkflowGraph = {
      nodes: [
        { id: 'a', type: 'table', position: { x: 0, y: 0 }, data: {} },
        { id: 'a', type: 'table', position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [],
    }
    expect(() => validateGraphStructure(bad)).toThrowError(/duplicate node/i)
  })

  it('accepts an empty graph', () => {
    expect(() => validateGraphStructure({ nodes: [], edges: [] })).not.toThrow()
  })
})

describe('partitionWorkflowEdges', () => {
  it('recovers forward edges that were falsely marked as loops after a rejection loop exists', () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: 'ig', type: 'table', position: { x: 0, y: 0 }, data: {} },
        { id: 'improve', type: 'table', position: { x: 1, y: 0 }, data: {} },
        { id: 'draft', type: 'table', position: { x: 2, y: 0 }, data: {} },
        { id: 'review', type: 'table', position: { x: 3, y: 0 }, data: {} },
        { id: 'human', type: 'table', position: { x: 4, y: 0 }, data: {} },
        { id: 'lesson', type: 'table', position: { x: 4, y: 1 }, data: {} },
      ],
      edges: [
        { id: 'e-ig-improve', source: 'ig', target: 'improve' },
        { id: 'e-improve-draft', source: 'improve', target: 'draft' },
        { id: 'e-draft-review', source: 'draft', target: 'review' },
        { id: 'e-human-lesson', source: 'human', target: 'lesson', sourceHandle: 'rejected' },
        { id: 'e-review-human', source: 'review', target: 'human', data: { loop: true } },
        { id: 'e-draft-human', source: 'draft', target: 'human', data: { loop: true } },
        { id: 'e-lesson-loop', source: 'lesson', target: 'improve', data: { loop: true } },
      ],
    }

    const { forward, loops } = partitionWorkflowEdges(graph)
    expect(forward.map((e) => e.id)).toContain('e-review-human')
    expect(forward.map((e) => e.id)).toContain('e-draft-human')
    expect(loops.map((e) => e.id)).toEqual(['e-lesson-loop'])
  })
})
