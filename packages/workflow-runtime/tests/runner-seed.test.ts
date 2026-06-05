import { describe, it, expect } from 'vitest'
import { runWorkflow } from '../src/runner.js'
import type { Executor, ExecutorContext, WorkflowGraph } from '../src/types.js'

function makeCtx(): ExecutorContext {
  return { signal: new AbortController().signal, emit: () => {}, runId: 'r1' } as unknown as ExecutorContext
}

// Echoes its upstream so we can assert the seeded payload flowed downstream.
const echo: Executor<unknown> = {
  type: 'echo',
  validateConfig: (raw) => raw,
  run: async (input) => ({ seen: input.upstream }),
}

// Should never run when seeded.
const boom: Executor<unknown> = {
  type: 'trigger',
  validateConfig: (raw) => raw,
  run: async () => { throw new Error('executor must not run when seeded') },
}

const graph: WorkflowGraph = {
  nodes: [
    { id: 'trig', type: 'trigger', position: { x: 0, y: 0 }, data: {} },
    { id: 'down', type: 'echo', position: { x: 1, y: 0 }, data: {} },
  ],
  edges: [{ id: 'e1', source: 'trig', target: 'down' }],
}

describe('runWorkflow seed', () => {
  it('injects a seeded node output and skips its executor', async () => {
    const registry = { trigger: boom, echo } as Record<string, Executor<unknown>>
    const result = await runWorkflow(graph, registry, makeCtx(), {
      seed: { trig: { kind: 'trigger', event: 'file', path: '/x.png' } },
    })
    expect(result.status).toBe('succeeded')
    expect(result.outputs.trig).toEqual({ kind: 'trigger', event: 'file', path: '/x.png' })
    expect(result.outputs.down).toEqual({ seen: { trig: { kind: 'trigger', event: 'file', path: '/x.png' } } })
    expect(result.stepStatuses.trig).toBe('succeeded')
  })
})
