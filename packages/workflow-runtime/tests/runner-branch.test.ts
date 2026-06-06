import { describe, it, expect } from 'vitest'
import { runWorkflow } from '../src/runner.js'
import type { Executor, ExecutorContext, WorkflowGraph } from '../src/types.js'

function ctx(): ExecutorContext {
  return { signal: new AbortController().signal, emit: () => {}, runId: 'r1' } as unknown as ExecutorContext
}

const registry: Record<string, Executor<unknown>> = {
  echo: {
    type: 'echo', validateConfig: (c) => c,
    run: async (i) => ({ value: (i.config as { value: string }).value }),
  },
  approver: {
    type: 'approver', validateConfig: (c) => c,
    run: async (i) => ({ kind: 'approval', decision: (i.config as { decision: string }).decision }),
  },
}

describe('runWorkflow branch pruning', () => {
  it('runs only the branch matching the approval decision; the other is skipped', async () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: 'gate', type: 'approver', position: { x: 0, y: 0 }, data: { decision: 'approved' } },
        { id: 'ok',   type: 'echo',     position: { x: 1, y: 0 }, data: { value: 'approved-path' } },
        { id: 'bad',  type: 'echo',     position: { x: 1, y: 1 }, data: { value: 'rejected-path' } },
      ],
      edges: [
        { id: 'e1', source: 'gate', target: 'ok',  sourceHandle: 'approved' },
        { id: 'e2', source: 'gate', target: 'bad', sourceHandle: 'rejected' },
      ],
    }
    const res = await runWorkflow(graph, registry, ctx())
    expect(res.status).toBe('succeeded')
    expect(res.stepStatuses.ok).toBe('succeeded')
    expect(res.stepStatuses.bad).toBe('skipped')
    expect(res.outputs.ok).toEqual({ value: 'approved-path' })
  })

  it('skips a node whose only input edge was pruned, and cascades', async () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: 'gate', type: 'approver', position: { x: 0, y: 0 }, data: { decision: 'rejected' } },
        { id: 'ok',   type: 'echo',     position: { x: 1, y: 0 }, data: { value: 'a' } },
        { id: 'after', type: 'echo',    position: { x: 2, y: 0 }, data: { value: 'b' } },
      ],
      edges: [
        { id: 'e1', source: 'gate', target: 'ok', sourceHandle: 'approved' },
        { id: 'e2', source: 'ok', target: 'after' },
      ],
    }
    const res = await runWorkflow(graph, registry, ctx())
    expect(res.status).toBe('succeeded')
    expect(res.stepStatuses.ok).toBe('skipped')
    expect(res.stepStatuses.after).toBe('skipped')
  })
})
