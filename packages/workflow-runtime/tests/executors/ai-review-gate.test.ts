import { describe, it, expect, vi } from 'vitest'
import { aiReviewGateExecutor } from '../../src/executors/ai-review-gate.js'

function makeCtx(text: string) {
  const spy = vi.fn().mockResolvedValue({ conversationId: 'c1', messageId: 'm1', text })
  const ctx = {
    crawler: { captureProfile: async () => ({ id: '', mediaUrls: [] }) },
    ocr: { extractFromImage: async () => '' },
    db: { getCapturedPost: async () => ({ id: '', mediaUrls: [] }) },
    fs: { writeRunArtifact: async () => '' },
    conversations: { createAndAwaitFirstTurn: spy, cancel: async () => {} },
    runId: 'run-1',
    signal: new AbortController().signal,
    emit: () => {},
  } as unknown as import('../../src/types.js').ExecutorContext
  return { ctx, spy }
}

const APPROVED =
  '```anubis-output\n{"text":"looks great","data":{"decision":"approved","score":92}}\n```'
const REJECTED =
  '```anubis-output\n{"text":"needs work","data":{"decision":"rejected","rejectionReason":"hook is weak","improvementInstruction":"open with a bolder claim"}}\n```'

describe('aiReviewGateExecutor', () => {
  it('emits an approval envelope and passes through reviewed upstream on approved', async () => {
    const { ctx } = makeCtx(APPROVED)
    const out = await aiReviewGateExecutor.run(
      { nodeId: 'review', config: { profileId: 'p', prompt: 'review it' }, upstream: { refine: { text: 'draft' } }, downstream: [] },
      ctx,
    )
    expect(out).toMatchObject({
      kind: 'approval',
      decision: 'approved',
      reviewed: { refine: { text: 'draft' } },
      review: { decision: 'approved', score: 92 },
    })
  })

  it('rejects with notes + improvement text from the review', async () => {
    const { ctx } = makeCtx(REJECTED)
    const out = await aiReviewGateExecutor.run(
      { nodeId: 'review', config: { profileId: 'p', prompt: 'review it' }, upstream: {}, downstream: [] },
      ctx,
    )
    expect(out).toMatchObject({ kind: 'approval', decision: 'rejected', notes: 'hook is weak' })
    expect((out as { text: string }).text).toBe('open with a bolder claim')
  })

  it('defaults to rejected when the reply has no valid decision', async () => {
    const { ctx } = makeCtx('no fenced block here')
    const out = await aiReviewGateExecutor.run(
      { nodeId: 'review', config: { profileId: 'p', prompt: 'review it' }, upstream: {}, downstream: [] },
      ctx,
    )
    expect((out as { decision: string }).decision).toBe('rejected')
  })

  it('forwards profile, reasoning, title and workflow metadata to the conversation', async () => {
    const { ctx, spy } = makeCtx(APPROVED)
    await aiReviewGateExecutor.run(
      { nodeId: 'review', config: { profileId: 'p', reasoning: 'high', prompt: 'go', titleTemplate: 'Rev' }, upstream: {}, downstream: [] },
      ctx,
    )
    expect(spy.mock.calls[0]![0]).toMatchObject({
      profileId: 'p', reasoning: 'high', title: 'Rev', source: 'workflow', workflow: { runId: 'run-1', nodeId: 'review' },
    })
  })

  it('defaults the conversation title to "Review · {nodeId}"', async () => {
    const { ctx, spy } = makeCtx(APPROVED)
    await aiReviewGateExecutor.run(
      { nodeId: 'review', config: { profileId: 'p', prompt: 'go' }, upstream: {}, downstream: [] },
      ctx,
    )
    expect(spy.mock.calls[0]![0].title).toBe('Review · review')
  })
})
