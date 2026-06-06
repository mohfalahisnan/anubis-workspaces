import { describe, it, expect } from 'vitest'
import { BUILTIN_WORKFLOWS } from '@anubis/conversation'
import { WorkflowGraphSchema, executorRegistry, topologicalSort } from '@anubis/workflow-runtime'

/**
 * Guards the seeded starter workflows against the runtime: every built-in must
 * be a structurally valid graph whose node types all have a registered
 * executor, so we never ship a workflow the engine can't run.
 */
describe('built-in workflows', () => {
  it('exposes at least the IG content pipeline', () => {
    expect(BUILTIN_WORKFLOWS.some((w) => w.id === 'builtin-ig-content-pipeline')).toBe(true)
  })

  for (const wf of BUILTIN_WORKFLOWS) {
    describe(wf.id, () => {
      const graph = WorkflowGraphSchema.parse(JSON.parse(wf.graph))

      it('parses as a valid workflow graph', () => {
        expect(graph.nodes.length).toBeGreaterThan(0)
      })

      it('is acyclic with edges that reference real nodes (runnable topology)', () => {
        expect(() => topologicalSort(graph)).not.toThrow()
      })

      it('uses only node types with a registered executor', () => {
        for (const node of graph.nodes) {
          expect(executorRegistry[node.type], `missing executor for "${node.type}"`).toBeDefined()
        }
      })

      it('only wires edges between declared nodes', () => {
        const ids = new Set(graph.nodes.map((n) => n.id))
        for (const e of graph.edges) {
          expect(ids.has(e.source), `edge source ${e.source}`).toBe(true)
          expect(ids.has(e.target), `edge target ${e.target}`).toBe(true)
        }
      })
    })
  }
})
