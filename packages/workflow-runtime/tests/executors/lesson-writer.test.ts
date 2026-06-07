import { describe, it, expect } from 'vitest'
import { lessonWriterExecutor } from '../../src/executors/lesson-writer.js'
import type { ExecutorContext } from '../../src/types.js'

function ctx(
  capture?: (input: { content: string; source?: string; workflow?: unknown }) => void,
  onLesson?: (input: { nodeId: string; lessonType: string; text: string; profileId?: string }) => void,
): ExecutorContext {
  return {
    runId: 'run-9', signal: new AbortController().signal, emit: () => {},
    conversations: {
      createAndAwaitFirstTurn: async (input: { content: string; source?: string; workflow?: unknown }) => {
        capture?.(input)
        return {
          conversationId: 'c1', messageId: 'm1',
          text: 'Lesson:\n```anubis-output\n{"text":"Avoid weak hooks"}\n```',
        }
      },
      cancel: async () => {},
    },
    lessons: {
      write: async (input: { nodeId: string; lessonType: string; text: string; profileId?: string }) => {
        onLesson?.(input)
        return { path: `/lesson/${input.nodeId}.md` }
      },
    },
  } as unknown as ExecutorContext
}

describe('lessonWriterExecutor', () => {
  it('writes a lesson and outputs text', async () => {
    const out = await lessonWriterExecutor.run(
      {
        nodeId: 'lw',
        config: { profileId: 'claude-research', lessonType: 'mistake' },
        upstream: { gate: { kind: 'approval', decision: 'rejected', notes: 'weak hook' } },
        downstream: [],
      },
      ctx(),
    ) as { kind: string; text: string; conversationId: string; path: string }
    expect(out.kind).toBe('lesson')
    expect(out.text).toContain('Avoid weak hooks')
    expect(out.conversationId).toBe('c1')
    expect(out.path).toContain('lw.md')
  })

  it('persists the lesson to the lesson store', async () => {
    let written: { nodeId: string; lessonType: string; text: string; profileId?: string } | undefined
    await lessonWriterExecutor.run(
      {
        nodeId: 'lw',
        config: { profileId: 'claude-research', lessonType: 'mistake' },
        upstream: { gate: { kind: 'approval', decision: 'rejected', notes: 'weak hook' } },
        downstream: [],
      },
      ctx(undefined, (input) => { written = input }),
    )
    expect(written).toEqual({
      nodeId: 'lw', lessonType: 'mistake', text: 'Avoid weak hooks', profileId: 'claude-research',
    })
  })

  it('surfaces the reviewer comment from an approval upstream into the prompt', async () => {
    let prompt = ''
    await lessonWriterExecutor.run(
      {
        nodeId: 'lw',
        config: { profileId: 'claude-research', lessonType: 'mistake' },
        upstream: { gate: { kind: 'approval', decision: 'rejected', notes: 'hook buried the offer' } },
        downstream: [],
      },
      ctx((input) => { prompt = input.content }),
    )
    expect(prompt).toContain('<reviewer-comment>')
    expect(prompt).toContain('hook buried the offer')
  })

  it('omits the reviewer-comment block when there is no approval comment', async () => {
    let prompt = ''
    await lessonWriterExecutor.run(
      {
        nodeId: 'lw',
        config: { profileId: 'claude-research', lessonType: 'lesson' },
        upstream: { src: { text: 'some content' } },
        downstream: [],
      },
      ctx((input) => { prompt = input.content }),
    )
    expect(prompt).not.toContain('<reviewer-comment>')
  })

  it('marks the backing conversation as workflow-created', async () => {
    let captured: { source?: string; workflow?: unknown } = {}
    await lessonWriterExecutor.run(
      {
        nodeId: 'lw',
        config: { profileId: 'claude-research', lessonType: 'lesson' },
        upstream: {},
        downstream: [],
      },
      ctx((input) => { captured = input }),
    )
    expect(captured.source).toBe('workflow')
    expect(captured.workflow).toEqual({ runId: 'run-9', nodeId: 'lw' })
  })

  it('requires profileId and a valid lessonType', () => {
    expect(() => lessonWriterExecutor.validateConfig({ lessonType: 'mistake' })).toThrow()
    expect(() => lessonWriterExecutor.validateConfig({ profileId: 'p', lessonType: 'bogus' })).toThrow()
    expect(() => lessonWriterExecutor.validateConfig({ profileId: 'p', lessonType: 'lesson' })).not.toThrow()
  })
})
