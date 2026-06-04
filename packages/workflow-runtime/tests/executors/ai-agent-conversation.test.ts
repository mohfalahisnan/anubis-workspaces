import { describe, it, expect, vi } from 'vitest'
import { aiAgentConversationExecutor } from '../../src/executors/ai-agent-conversation.js'

function makeCtx(spy = vi.fn().mockResolvedValue({ conversationId: 'c1', messageId: 'm1', text: 'hi there' })) {
  return {
    crawler: { captureProfile: async () => ({ id: '', mediaUrls: [] }) },
    ocr: { extractFromImage: async () => '' },
    db: { getCapturedPost: async () => ({ id: '', mediaUrls: [] }) },
    fs: { writeRunArtifact: async () => '' },
    conversations: {
      createAndAwaitFirstTurn: spy,
      cancel: async () => {},
    },
    runId: 'r1',
    signal: new AbortController().signal,
    emit: () => {},
  } as const
}

describe('aiAgentConversationExecutor', () => {
  it('returns { kind, conversationId, messageId, text }', async () => {
    const ctx = makeCtx()
    const out = await aiAgentConversationExecutor.run(
      {
        nodeId: 'n1',
        config: { profileId: 'claude-coding', reasoning: 'medium', prompt: 'hi' },
        upstream: {},
      },
      ctx,
    )
    expect(out).toEqual({ kind: 'conversation', conversationId: 'c1', messageId: 'm1', text: 'hi there' })
  })

  it('wraps each upstream entry in a context block', async () => {
    const spy = vi.fn().mockResolvedValue({ conversationId: 'c1', messageId: 'm1', text: '' })
    const ctx = makeCtx(spy)
    await aiAgentConversationExecutor.run(
      {
        nodeId: 'n1',
        config: { profileId: 'p', prompt: 'do it' },
        upstream: { srcA: { foo: 1 }, srcB: { bar: 2 } },
      },
      ctx,
    )
    const sent = spy.mock.calls[0]![0].content as string
    expect(sent).toMatch(/<context source="srcA">/)
    expect(sent).toMatch(/"foo": 1/)
    expect(sent).toMatch(/<context source="srcB">/)
    expect(sent).toMatch(/"bar": 2/)
    expect(sent).toMatch(/do it\s*$/)
  })

  it('collects file paths from { paths }, { mediaPaths }, and { kind:"file", path }', async () => {
    const spy = vi.fn().mockResolvedValue({ conversationId: 'c1', messageId: 'm1', text: '' })
    const ctx = makeCtx(spy)
    await aiAgentConversationExecutor.run(
      {
        nodeId: 'n1',
        config: { profileId: 'p', prompt: 'do it' },
        upstream: {
          a: { paths: ['C:\\a.png', 'C:\\b.png'] },
          b: { mediaPaths: ['/tmp/c.mp4'] },
          c: { kind: 'file', path: '/tmp/d.json' },
        },
      },
      ctx,
    )
    const sent = spy.mock.calls[0]![0].content as string
    expect(sent).toMatch(/Attached files:/)
    expect(sent).toMatch(/- C:\\a\.png/)
    expect(sent).toMatch(/- C:\\b\.png/)
    expect(sent).toMatch(/- \/tmp\/c\.mp4/)
    expect(sent).toMatch(/- \/tmp\/d\.json/)
  })

  it('forwards reasoning to createAndAwaitFirstTurn', async () => {
    const spy = vi.fn().mockResolvedValue({ conversationId: 'c1', messageId: 'm1', text: '' })
    const ctx = makeCtx(spy)
    await aiAgentConversationExecutor.run(
      {
        nodeId: 'n1',
        config: { profileId: 'p', reasoning: 'high', prompt: 'go' },
        upstream: {},
      },
      ctx,
    )
    expect(spy.mock.calls[0]![0].reasoning).toBe('high')
    expect(spy.mock.calls[0]![0].profileId).toBe('p')
  })

  it('uses titleTemplate when provided, else default', async () => {
    const spy = vi.fn().mockResolvedValue({ conversationId: 'c1', messageId: 'm1', text: '' })
    const ctx = makeCtx(spy)
    await aiAgentConversationExecutor.run(
      { nodeId: 'n1', config: { profileId: 'p', prompt: 'x', titleTemplate: 'Run X' }, upstream: {} },
      ctx,
    )
    expect(spy.mock.calls[0]![0].title).toBe('Run X')

    spy.mockClear()
    await aiAgentConversationExecutor.run(
      { nodeId: 'n1', config: { profileId: 'p', prompt: 'x' }, upstream: {} },
      ctx,
    )
    expect(spy.mock.calls[0]![0].title).toBe('Workflow · n1')
  })
})
