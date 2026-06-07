import { describe, it, expect } from 'vitest'
import { humanApprovalExecutor } from '../../src/executors/human-approval.js'
import type { ExecutorContext } from '../../src/types.js'

function ctx(decision: 'approved' | 'rejected'): ExecutorContext {
  return {
    approvals: { waitFor: async () => ({ decision, notes: 'ok' }) },
    signal: new AbortController().signal, emit: () => {}, runId: 'r',
  } as unknown as ExecutorContext
}

describe('humanApprovalExecutor', () => {
  it('passes upstream through, surfaces the approved text, and returns the decision', async () => {
    const out = await humanApprovalExecutor.run(
      { nodeId: 'gate', config: { title: 'Review' }, upstream: { x: { text: 'draft' } }, downstream: [] },
      ctx('approved'),
    )
    expect(out).toMatchObject({
      kind: 'approval', decision: 'approved', notes: 'ok',
      text: 'draft',
      reviewed: { x: { text: 'draft' } },
    })
  })

  it('surfaces empty text when upstream has no renderable text', async () => {
    const out = await humanApprovalExecutor.run(
      { nodeId: 'gate', config: {}, upstream: { x: { count: 1 } }, downstream: [] },
      ctx('approved'),
    ) as { text: string }
    expect(out.text).toBe('')
  })

  it('validates config (title optional, maxIterations must be positive)', () => {
    expect(() => humanApprovalExecutor.validateConfig({})).not.toThrow()
    expect(() => humanApprovalExecutor.validateConfig({ maxIterations: 3 })).not.toThrow()
    expect(() => humanApprovalExecutor.validateConfig({ maxIterations: 0 })).toThrow()
  })
})
