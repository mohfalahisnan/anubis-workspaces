import { describe, it, expect, vi } from 'vitest'
import { runWorkflow } from '../src/runner.js'
import { aiReviewGateExecutor } from '../src/executors/ai-review-gate.js'
import { lessonWriterExecutor } from '../src/executors/lesson-writer.js'
import type { Executor, ExecutorContext, WorkflowGraph } from '../src/types.js'

function verdict(decision: 'approved' | 'rejected'): string {
  return `\`\`\`anubis-output\n{"text":"v","data":{"decision":"${decision}","rejectionReason":"fix it","improvementInstruction":"do better"}}\n\`\`\``
}
const LESSON_REPLY = '```anubis-output\n{"text":"lesson text"}\n```'

/** Returns a verdict for profile `reviewer`, a lesson otherwise. `approveOnAttempt` = which review call approves. */
function makeCtx(approveOnAttempt: number) {
  let reviewCalls = 0
  const conversations = {
    createAndAwaitFirstTurn: vi.fn(async ({ profileId }: { profileId: string }) => {
      if (profileId === 'reviewer') {
        reviewCalls++
        return { conversationId: 'c', messageId: 'm', text: verdict(reviewCalls >= approveOnAttempt ? 'approved' : 'rejected') }
      }
      return { conversationId: 'c', messageId: 'm', text: LESSON_REPLY }
    }),
    cancel: async () => {},
  }
  const lessons = { write: vi.fn(async () => ({ path: '/tmp/lesson.md' })) }
  const ctx = { conversations, lessons, runId: 'r1', signal: new AbortController().signal, emit: () => {} } as unknown as ExecutorContext
  return { ctx, conversations, lessons, reviews: () => reviewCalls }
}

function graph(maxIterations: number): WorkflowGraph {
  return {
    nodes: [
      { id: 'refine', type: 'refine', position: { x: 0, y: 0 }, data: {} },
      { id: 'review', type: 'aiReviewGate', position: { x: 1, y: 0 }, data: { profileId: 'reviewer', prompt: 'review', maxIterations } },
      { id: 'lesson', type: 'lessonWriter', position: { x: 2, y: 1 }, data: { profileId: 'lessoner', lessonType: 'mistake' } },
      { id: 'done', type: 'done', position: { x: 2, y: 0 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 'refine', target: 'review' },
      { id: 'e2', source: 'review', target: 'done', sourceHandle: 'approved' },
      { id: 'e3', source: 'review', target: 'lesson', sourceHandle: 'rejected' },
      { id: 'e4', source: 'lesson', target: 'refine', data: { loop: true } },
    ],
  }
}

function registry(): Record<string, Executor<unknown>> {
  let refineCalls = 0
  return {
    refine: { type: 'refine', validateConfig: (c) => c, run: async () => ({ kind: 'aiAgent', text: `draft-${++refineCalls}`, data: { caption: 'c' } }) },
    aiReviewGate: aiReviewGateExecutor as Executor<unknown>,
    lessonWriter: lessonWriterExecutor as Executor<unknown>,
    done: { type: 'done', validateConfig: (c) => c, run: async () => ({ value: 'final' }) },
  }
}

describe('content studio review loop (real aiReviewGate + lessonWriter)', () => {
  it('loops reject→lesson→refine until approved, bounded by maxIterations', async () => {
    const { ctx, lessons, reviews } = makeCtx(3) // approve on the 3rd review
    const res = await runWorkflow(graph(5), registry(), ctx)
    expect(res.status).toBe('succeeded')
    expect(res.stepStatuses.done).toBe('succeeded')
    expect(reviews()).toBe(3)
    expect(lessons.write).toHaveBeenCalledTimes(2) // two rejections wrote two lessons
  })

  it('ends rejected when maxIterations is exceeded', async () => {
    const { ctx } = makeCtx(99) // never approves
    const res = await runWorkflow(graph(2), registry(), ctx)
    expect(res.status).toBe('rejected')
    expect(res.stepStatuses.done).toBe('skipped')
  })
})
