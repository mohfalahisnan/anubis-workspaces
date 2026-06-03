import { describe, it, expect } from 'vitest'
import { serializeSelection, deserializeSelection } from '@/components/workflow-editor/clipboard/use-editor-clipboard'

describe('clipboard serialization', () => {
  it('serializes only selected nodes and edges where both endpoints are selected', () => {
    const nodes = [
      { id: 'a', type: 'table', position: { x: 0, y: 0 }, data: {} },
      { id: 'b', type: 'table', position: { x: 100, y: 0 }, data: {} },
      { id: 'c', type: 'table', position: { x: 200, y: 0 }, data: {} },
    ]
    const edges = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
    ]
    const json = serializeSelection(nodes as never, edges as never, ['a', 'b'])
    const parsed = JSON.parse(json)
    expect(parsed.nodes.map((n: { id: string }) => n.id)).toEqual(['a', 'b'])
    expect(parsed.edges.map((e: { id: string }) => e.id)).toEqual(['e1'])
  })

  it('rewrites IDs and offsets positions on deserialize', () => {
    const json = JSON.stringify({
      nodes: [
        { id: 'a', type: 'table', position: { x: 0, y: 0 }, data: {} },
        { id: 'b', type: 'table', position: { x: 100, y: 0 }, data: {} },
      ],
      edges: [{ id: 'e1', source: 'a', target: 'b' }],
    })
    let n = 0
    const { nodes, edges } = deserializeSelection(json, () => `id-${n++}`, { dx: 20, dy: 20 })
    expect(nodes.map((node) => node.id)).toEqual(['id-0', 'id-1'])
    expect(edges[0]!.source).toBe('id-0')
    expect(edges[0]!.target).toBe('id-1')
    expect(nodes[0]!.position).toEqual({ x: 20, y: 20 })
  })
})
