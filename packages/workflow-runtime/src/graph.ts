import type { WorkflowEdge, WorkflowGraph } from './types.js'

export function validateGraphStructure(graph: WorkflowGraph): void {
  const ids = new Set<string>()
  for (const node of graph.nodes) {
    if (ids.has(node.id)) throw new Error(`duplicate node id: ${node.id}`)
    ids.add(node.id)
  }
  for (const edge of graph.edges) {
    if (!ids.has(edge.source)) throw new Error(`edge ${edge.id} references missing node: ${edge.source}`)
    if (!ids.has(edge.target)) throw new Error(`edge ${edge.id} references missing node: ${edge.target}`)
  }
}

export function topologicalSort(graph: WorkflowGraph): string[] {
  validateGraphStructure(graph)
  const inDegree = new Map<string, number>()
  const outgoing = new Map<string, string[]>()
  for (const node of graph.nodes) {
    inDegree.set(node.id, 0)
    outgoing.set(node.id, [])
  }
  for (const edge of graph.edges) {
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1)
    outgoing.get(edge.source)!.push(edge.target)
  }
  const queue: string[] = []
  for (const [id, deg] of inDegree) if (deg === 0) queue.push(id)
  const order: string[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    order.push(id)
    for (const next of outgoing.get(id) ?? []) {
      const left = (inDegree.get(next) ?? 0) - 1
      inDegree.set(next, left)
      if (left === 0) queue.push(next)
    }
  }
  if (order.length !== graph.nodes.length) {
    throw new Error('graph contains a cycle')
  }
  return order
}

export function isLoopEdge(e: WorkflowEdge): boolean {
  return e.data?.loop === true
}

/**
 * Reject cycles formed by non-loop edges only. Loop edges (`data.loop`) are
 * permitted to be back-edges — they re-arm a bounded loop body at runtime.
 */
export function assertAcyclicExceptLoops(graph: WorkflowGraph): void {
  validateGraphStructure(graph)
  const forward = graph.edges.filter((e) => !isLoopEdge(e))
  topologicalSort({ nodes: graph.nodes, edges: forward })
}

export function incomingEdges(graph: WorkflowGraph, nodeId: string): string[] {
  return graph.edges.filter((e) => e.target === nodeId).map((e) => e.source)
}

export function outgoingEdges(graph: WorkflowGraph, nodeId: string): string[] {
  return graph.edges.filter((e) => e.source === nodeId).map((e) => e.target)
}
