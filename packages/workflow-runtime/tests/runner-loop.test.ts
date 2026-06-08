import { describe, it, expect } from 'vitest'
import { runWorkflow } from '../src/runner.js'
import type { Executor, ExecutorContext, WorkflowGraph } from '../src/types.js'

function ctx(): ExecutorContext {
  return { signal: new AbortController().signal, emit: () => {}, runId: 'r1' } as unknown as ExecutorContext
}

function loopGraph(maxIterations: number): WorkflowGraph {
  return {
    nodes: [
      { id: 'improve', type: 'improve', position: { x: 0, y: 0 }, data: {} },
      { id: 'gate',    type: 'gate',    position: { x: 1, y: 0 }, data: { maxIterations } },
      { id: 'done',    type: 'done',    position: { x: 2, y: 0 }, data: {} },
      { id: 'lesson',  type: 'lesson',  position: { x: 2, y: 1 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 'improve', target: 'gate' },
      { id: 'e2', source: 'gate', target: 'done',   sourceHandle: 'approved' },
      { id: 'e3', source: 'gate', target: 'lesson', sourceHandle: 'rejected' },
      { id: 'e4', source: 'lesson', target: 'improve', data: { loop: true } },
    ],
  }
}

describe('runWorkflow bounded loop', () => {
  it('loops reject→lesson→improve until approved, bounded', async () => {
    let attempt = 0
    const registry: Record<string, Executor<unknown>> = {
      improve: { type: 'improve', validateConfig: (c) => c, run: async () => ({ value: ++attempt }) },
      gate: {
        type: 'gate', validateConfig: (c) => c,
        run: async (i) => ({ kind: 'approval', decision: (i.upstream['improve'] as { value: number }).value >= 3 ? 'approved' : 'rejected' }),
      },
      lesson: { type: 'lesson', validateConfig: (c) => c, run: async () => ({ kind: 'lesson', text: 'try harder' }) },
      done: { type: 'done', validateConfig: (c) => c, run: async () => ({ value: 'final' }) },
    }
    const res = await runWorkflow(loopGraph(5), registry, ctx())
    expect(res.status).toBe('succeeded')
    expect(attempt).toBe(3)
    expect(res.stepStatuses.done).toBe('succeeded')
    expect(res.stepStatuses.lesson).toBe('skipped') // last pass approved → lesson not taken
  })

  it('ends rejected when maxIterations is exceeded', async () => {
    const registry: Record<string, Executor<unknown>> = {
      improve: { type: 'improve', validateConfig: (c) => c, run: async () => ({ value: 1 }) },
      gate: { type: 'gate', validateConfig: (c) => c, run: async () => ({ kind: 'approval', decision: 'rejected' }) },
      lesson: { type: 'lesson', validateConfig: (c) => c, run: async () => ({ kind: 'lesson', text: 'x' }) },
      done: { type: 'done', validateConfig: (c) => c, run: async () => ({ value: 'final' }) },
    }
    const res = await runWorkflow(loopGraph(2), registry, ctx())
    expect(res.status).toBe('rejected')
    expect(res.stepStatuses.done).toBe('skipped')
  })

  it('feeds the previous lesson back into improve via the loop edge', async () => {
    const seenLessons: Array<string | undefined> = []
    let lessonNo = 0
    const registry: Record<string, Executor<unknown>> = {
      improve: {
        type: 'improve', validateConfig: (c) => c,
        run: async (i) => {
          seenLessons.push((i.upstream['lesson'] as { text?: string } | undefined)?.text)
          return { value: seenLessons.length }
        },
      },
      gate: {
        type: 'gate', validateConfig: (c) => c,
        run: async (i) => ({ kind: 'approval', decision: (i.upstream['improve'] as { value: number }).value >= 2 ? 'approved' : 'rejected' }),
      },
      lesson: { type: 'lesson', validateConfig: (c) => c, run: async () => ({ kind: 'lesson', text: `lesson-${++lessonNo}` }) },
      done: { type: 'done', validateConfig: (c) => c, run: async () => ({ value: 'final' }) },
    }
    const res = await runWorkflow(loopGraph(5), registry, ctx())
    expect(res.status).toBe('succeeded')
    expect(seenLessons[0]).toBeUndefined()  // first pass: no lesson yet
    expect(seenLessons[1]).toBe('lesson-1') // second pass: sees lesson from the first rejection
  })

  it('does not let falsely loop-marked forward edges make an approval node run as a source', async () => {
    const order: string[] = []
    const graph: WorkflowGraph = {
      nodes: [
        { id: 'ig', type: 'step', position: { x: 0, y: 0 }, data: {} },
        { id: 'improve', type: 'step', position: { x: 1, y: 0 }, data: {} },
        { id: 'draft', type: 'step', position: { x: 2, y: 0 }, data: {} },
        { id: 'review', type: 'step', position: { x: 3, y: 0 }, data: {} },
        { id: 'human', type: 'approval', position: { x: 4, y: 0 }, data: {} },
        { id: 'lesson', type: 'step', position: { x: 4, y: 1 }, data: {} },
        { id: 'done', type: 'step', position: { x: 5, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'e-ig-improve', source: 'ig', target: 'improve' },
        { id: 'e-improve-draft', source: 'improve', target: 'draft' },
        { id: 'e-draft-review', source: 'draft', target: 'review' },
        { id: 'e-human-lesson', source: 'human', target: 'lesson', sourceHandle: 'rejected' },
        { id: 'e-human-done', source: 'human', target: 'done', sourceHandle: 'approved' },
        { id: 'e-review-human', source: 'review', target: 'human', data: { loop: true } },
        { id: 'e-draft-human', source: 'draft', target: 'human', data: { loop: true } },
        { id: 'e-lesson-loop', source: 'lesson', target: 'improve', data: { loop: true } },
      ],
    }
    const registry: Record<string, Executor<unknown>> = {
      step: {
        type: 'step',
        validateConfig: (c) => c,
        run: async (i) => {
          order.push(i.nodeId)
          return { text: i.nodeId }
        },
      },
      approval: {
        type: 'approval',
        validateConfig: (c) => c,
        run: async (i) => {
          order.push(i.nodeId)
          expect(Object.keys(i.upstream).sort()).toEqual(['draft', 'review'])
          return { kind: 'approval', decision: 'approved' }
        },
      },
    }

    const res = await runWorkflow(graph, registry, ctx())
    expect(res.status).toBe('succeeded')
    expect(order.indexOf('human')).toBeGreaterThan(order.indexOf('review'))
    expect(res.stepStatuses.done).toBe('succeeded')
    expect(res.stepStatuses.lesson).toBe('skipped')
  })
})
