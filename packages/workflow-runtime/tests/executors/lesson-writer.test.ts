import { describe, it, expect, vi } from 'vitest'
import { lessonWriterExecutor } from '../../src/executors/lesson-writer.js'
import type { ExecutorContext } from '../../src/types.js'

function ctx(recordCandidate: ReturnType<typeof vi.fn>): ExecutorContext {
  return {
    workspaceId: 'brand-1', runId: 'run-9', signal: new AbortController().signal, emit: () => {},
    experience: { recordCandidate },
    conversations: {
      createAndAwaitFirstTurn: async () => ({
        conversationId: 'c1', messageId: 'm1',
        text: 'Lesson:\n```anubis-output\n{"text":"Avoid weak hooks"}\n```',
      }),
      cancel: async () => {},
    },
  } as unknown as ExecutorContext
}

describe('lessonWriterExecutor', () => {
  it('writes a lesson, outputs text, and persists an experience memory', async () => {
    const rec = vi.fn(() => ({ id: 'mem-1' }))
    const out = await lessonWriterExecutor.run(
      {
        nodeId: 'lw',
        config: { profileId: 'claude-research', lessonType: 'mistake' },
        upstream: { gate: { kind: 'approval', decision: 'rejected', notes: 'weak hook' } },
        downstream: [],
      },
      ctx(rec),
    ) as { kind: string; text: string; memoryId: string }
    expect(out.kind).toBe('lesson')
    expect(out.text).toContain('Avoid weak hooks')
    expect(out.memoryId).toBe('mem-1')
    expect(rec).toHaveBeenCalledWith(expect.objectContaining({
      type: 'mistake', workspaceId: 'brand-1', sourceRunId: 'run-9',
    }))
  })

  it('requires profileId and a valid lessonType', () => {
    expect(() => lessonWriterExecutor.validateConfig({ lessonType: 'mistake' })).toThrow()
    expect(() => lessonWriterExecutor.validateConfig({ profileId: 'p', lessonType: 'bogus' })).toThrow()
    expect(() => lessonWriterExecutor.validateConfig({ profileId: 'p', lessonType: 'lesson' })).not.toThrow()
  })
})
