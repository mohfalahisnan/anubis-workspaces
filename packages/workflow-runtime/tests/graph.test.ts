import { describe, it, expect } from 'vitest'
import { topologicalSort, validateGraphStructure } from '../src/graph.js'
import type { WorkflowGraph } from '../src/types.js'

function g(nodes: string[], edges: Array<[string, string]>): WorkflowGraph {
  return {
    nodes: nodes.map((id) => ({ id, type: 'table', position: { x: 0, y: 0 }, config: {} })),
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
        { id: 'a', type: 'table', position: { x: 0, y: 0 }, config: {} },
        { id: 'a', type: 'table', position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [],
    }
    expect(() => validateGraphStructure(bad)).toThrowError(/duplicate node/i)
  })

  it('accepts an empty graph', () => {
    expect(() => validateGraphStructure({ nodes: [], edges: [] })).not.toThrow()
  })
})
