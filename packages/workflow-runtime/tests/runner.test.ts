import { describe, it, expect } from 'vitest'
import { runWorkflow } from '../src/runner.js'
import type { Executor, ExecutorContext, NodeRunEvent, WorkflowGraph } from '../src/types.js'

const fakeExecutor = (type: string, run: (input: { config: { v?: string }; upstream: Record<string, unknown> }) => Promise<unknown>): Executor<unknown> => ({
  type,
  validateConfig: (raw) => raw,
  run: (input) => run(input as never),
})

function makeCtx(emit: (e: NodeRunEvent) => void, signal: AbortSignal = new AbortController().signal): ExecutorContext {
  return {
    agent: { run: async () => ({ text: '' }) },
    crawler: { captureProfile: async () => ({ id: '', mediaUrls: [] }) },
    ocr: { extractFromImage: async () => '' },
    db: { getCapturedPost: async () => ({ id: '', mediaUrls: [] }) },
    fs: { writeRunArtifact: async () => '' },
    runId: 'r1',
    signal,
    emit,
  }
}

function g(): WorkflowGraph {
  return {
    nodes: [
      { id: 'a', type: 'echo', position: { x: 0, y: 0 }, data: { v: 'A' } },
      { id: 'b', type: 'echo', position: { x: 0, y: 0 }, data: { v: 'B' } },
      { id: 'c', type: 'merge', position: { x: 0, y: 0 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 'a', target: 'c' },
      { id: 'e2', source: 'b', target: 'c' },
    ],
  }
}

describe('runWorkflow', () => {
  it('runs in topological order and emits started+succeeded for each node', async () => {
    const events: NodeRunEvent[] = []
    const registry = {
      echo: fakeExecutor('echo', async (i) => i.config.v),
      merge: fakeExecutor('merge', async (i) => Object.values(i.upstream).join('+')),
    }
    const ctx = makeCtx((e) => events.push(e))
    const result = await runWorkflow(g(), registry, ctx)
    expect(result.status).toBe('succeeded')
    const lastSucceeded = events.filter((e) => e.kind === 'node-succeeded').at(-1)
    expect(lastSucceeded?.nodeId).toBe('c')
    expect((lastSucceeded as { output?: string } | undefined)?.output).toBe('A+B')
  })

  it('halts on first failure and marks remaining nodes skipped', async () => {
    const events: NodeRunEvent[] = []
    const registry = {
      echo: fakeExecutor('echo', async () => { throw new Error('boom') }),
      merge: fakeExecutor('merge', async () => 'should not run'),
    }
    const result = await runWorkflow(g(), registry, makeCtx((e) => events.push(e)))
    expect(result.status).toBe('failed')
    expect(events.some((e) => e.kind === 'node-failed')).toBe(true)
    expect(result.stepStatuses.c).toBe('skipped')
  })

  it('cancels remaining nodes when signal aborts', async () => {
    const ctrl = new AbortController()
    const events: NodeRunEvent[] = []
    const registry = {
      echo: fakeExecutor('echo', async () => { ctrl.abort(); return 'ok' }),
      merge: fakeExecutor('merge', async () => 'should not run'),
    }
    const result = await runWorkflow(g(), registry, makeCtx((e) => events.push(e), ctrl.signal))
    expect(result.status).toBe('cancelled')
    expect(result.stepStatuses.c).toBe('skipped')
  })

  it('rejects an invalid graph before any node runs', async () => {
    const cyclic: WorkflowGraph = {
      nodes: [
        { id: 'a', type: 'echo', position: { x: 0, y: 0 }, data: {} },
        { id: 'b', type: 'echo', position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'b', target: 'a' },
      ],
    }
    const events: NodeRunEvent[] = []
    const registry = { echo: fakeExecutor('echo', async () => 'x') }
    await expect(runWorkflow(cyclic, registry, makeCtx((e) => events.push(e))))
      .rejects.toThrow(/cycle/i)
    expect(events.length).toBe(0)
  })
})
