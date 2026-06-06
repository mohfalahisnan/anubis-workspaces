import { describe, it, expect, vi } from 'vitest'
import { lessonWriterExecutor } from '../../src/executors/lesson-writer.js'
import type { ExecutorContext } from '../../src/types.js'

function ctx(recordCandidate: ReturnType<typeof vi.fn>, capture?: (content: string) => void): ExecutorContext {
  return {
    workspaceId: 'brand-1', runId: 'run-9', signal: new AbortController().signal, emit: () => {},
    experience: { recordCandidate },
    conversations: {
      createAndAwaitFirstTurn: async (input: { content: string }) => {
        capture?.(input.content)
        return {
          conversationId: 'c1', messageId: 'm1',
          text: 'Lesson:\n```anubis-output\n{"text":"Avoid weak hooks"}\n```',
        }
      },
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

  it('surfaces the reviewer comment from an approval upstream into the prompt', async () => {
    const rec = vi.fn(() => ({ id: 'mem-1' }))
    let prompt = ''
    await lessonWriterExecutor.run(
      {
        nodeId: 'lw',
        config: { profileId: 'claude-research', lessonType: 'mistake' },
        upstream: { gate: { kind: 'approval', decision: 'rejected', notes: 'hook buried the offer' } },
        downstream: [],
      },
      ctx(rec, (c) => { prompt = c }),
    )
    expect(prompt).toContain('<reviewer-comment>')
    expect(prompt).toContain('hook buried the offer')
  })

  it('omits the reviewer-comment block when there is no approval comment', async () => {
    const rec = vi.fn(() => ({ id: 'mem-1' }))
    let prompt = ''
    await lessonWriterExecutor.run(
      {
        nodeId: 'lw',
        config: { profileId: 'claude-research', lessonType: 'lesson' },
        upstream: { src: { text: 'some content' } },
        downstream: [],
      },
      ctx(rec, (c) => { prompt = c }),
    )
    expect(prompt).not.toContain('<reviewer-comment>')
  })

  it('requires profileId and a valid lessonType', () => {
    expect(() => lessonWriterExecutor.validateConfig({ lessonType: 'mistake' })).toThrow()
    expect(() => lessonWriterExecutor.validateConfig({ profileId: 'p', lessonType: 'bogus' })).toThrow()
    expect(() => lessonWriterExecutor.validateConfig({ profileId: 'p', lessonType: 'lesson' })).not.toThrow()
  })
})
