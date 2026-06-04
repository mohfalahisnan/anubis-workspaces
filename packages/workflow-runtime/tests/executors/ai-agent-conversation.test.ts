import { describe, it, expect, vi } from 'vitest'
import { aiAgentConversationExecutor } from '../../src/executors/ai-agent-conversation.js'

const ENVELOPE_REPLY =
  '```anubis-output\n{"text":"hi there","data":{"foo":"bar"},"paths":["/tmp/x"]}\n```'

function makeCtx(
  spy = vi.fn().mockResolvedValue({ conversationId: 'c1', messageId: 'm1', text: ENVELOPE_REPLY }),
) {
  return {
    crawler: { captureProfile: async () => ({ id: '', mediaUrls: [] }) },
    ocr: { extractFromImage: async () => '' },
    db: { getCapturedPost: async () => ({ id: '', mediaUrls: [] }) },
    fs: { writeRunArtifact: async () => '' },
    conversations: {
      createAndAwaitFirstTurn: spy,
      cancel: async () => {},
    },
    runId: 'run-1',
    signal: new AbortController().signal,
    emit: () => {},
  } as const
}

describe('aiAgentConversationExecutor', () => {
  it('returns the parsed envelope fields on the output object', async () => {
    const ctx = makeCtx()
    const out = await aiAgentConversationExecutor.run(
      {
        nodeId: 'n1',
        config: { profileId: 'claude-coding', reasoning: 'medium', prompt: 'hi' },
        upstream: {},
        downstream: [],
      },
      ctx,
    )
    expect(out).toEqual({
      kind: 'aiAgent',
      conversationId: 'c1',
      messageId: 'm1',
      text: 'hi there',
      data: { foo: 'bar' },
      paths: ['/tmp/x'],
    })
  })

  it('falls back to whole-reply-as-text when envelope is missing', async () => {
    const spy = vi.fn().mockResolvedValue({ conversationId: 'c1', messageId: 'm1', text: 'just text' })
    const ctx = makeCtx(spy)
    const out = await aiAgentConversationExecutor.run(
      { nodeId: 'n1', config: { profileId: 'p', prompt: 'hi' }, upstream: {}, downstream: [] },
      ctx,
    )
    expect(out).toMatchObject({ kind: 'aiAgent', text: 'just text', data: undefined, paths: undefined })
  })

  it('emits a <workflow-context> block with runId, nodeId and downstream array', async () => {
    const spy = vi.fn().mockResolvedValue({ conversationId: 'c1', messageId: 'm1', text: ENVELOPE_REPLY })
    const ctx = makeCtx(spy)
    await aiAgentConversationExecutor.run(
      {
        nodeId: 'ai-1',
        config: { profileId: 'p', prompt: 'do it' },
        upstream: {},
        downstream: [{ nodeId: 't-1', type: 'transformerBrief' }],
      },
      ctx,
    )
    const sent = spy.mock.calls[0]![0].content as string
    expect(sent).toMatch(/<workflow-context>/)
    expect(sent).toMatch(/"runId":\s*"run-1"/)
    expect(sent).toMatch(/"nodeId":\s*"ai-1"/)
    expect(sent).toMatch(/"type":\s*"transformerBrief"/)
    expect(sent).toMatch(/<\/workflow-context>/)
  })

  it('emits an <output-spec> block with the contract for each unique downstream type', async () => {
    const spy = vi.fn().mockResolvedValue({ conversationId: 'c1', messageId: 'm1', text: ENVELOPE_REPLY })
    const ctx = makeCtx(spy)
    await aiAgentConversationExecutor.run(
      {
        nodeId: 'ai-1',
        config: { profileId: 'p', prompt: 'go' },
        upstream: {},
        downstream: [
          { nodeId: 't-1', type: 'transformerBrief' },
          { nodeId: 't-2', type: 'transformerBrief' },
          { nodeId: 'a-1', type: 'aiAgentConversation' },
        ],
      },
      ctx,
    )
    const sent = spy.mock.calls[0]![0].content as string
    expect(sent).toMatch(/<output-spec>/)
    expect(sent).toMatch(/anubis-output/)
    // transformerBrief appears exactly once even though listed twice in downstream
    const briefMatches = sent.match(/- transformerBrief:/g) ?? []
    expect(briefMatches.length).toBe(1)
    expect(sent).toMatch(/- aiAgentConversation:/)
    expect(sent).toMatch(/<\/output-spec>/)
  })

  it('uses the default contract for unknown downstream types', async () => {
    const spy = vi.fn().mockResolvedValue({ conversationId: 'c1', messageId: 'm1', text: ENVELOPE_REPLY })
    const ctx = makeCtx(spy)
    await aiAgentConversationExecutor.run(
      {
        nodeId: 'ai-1',
        config: { profileId: 'p', prompt: 'go' },
        upstream: {},
        downstream: [{ nodeId: 'x-1', type: 'someFutureNode' }],
      },
      ctx,
    )
    const sent = spy.mock.calls[0]![0].content as string
    expect(sent).toMatch(/- someFutureNode:/)
    expect(sent).toMatch(/Emit the standard envelope/)
  })

  it('emits a "(no downstream)" line when downstream is empty', async () => {
    const spy = vi.fn().mockResolvedValue({ conversationId: 'c1', messageId: 'm1', text: ENVELOPE_REPLY })
    const ctx = makeCtx(spy)
    await aiAgentConversationExecutor.run(
      { nodeId: 'ai-1', config: { profileId: 'p', prompt: 'go' }, upstream: {}, downstream: [] },
      ctx,
    )
    const sent = spy.mock.calls[0]![0].content as string
    expect(sent).toMatch(/\(no downstream\)/)
  })

  it('still wraps upstream entries in <context> blocks and lists files', async () => {
    const spy = vi.fn().mockResolvedValue({ conversationId: 'c1', messageId: 'm1', text: ENVELOPE_REPLY })
    const ctx = makeCtx(spy)
    await aiAgentConversationExecutor.run(
      {
        nodeId: 'ai-1',
        config: { profileId: 'p', prompt: 'go' },
        upstream: {
          srcA: { foo: 1, paths: ['C:\\a.png'] },
        },
        downstream: [],
      },
      ctx,
    )
    const sent = spy.mock.calls[0]![0].content as string
    expect(sent).toMatch(/<context source="srcA">/)
    expect(sent).toMatch(/"foo": 1/)
    expect(sent).toMatch(/Attached files:/)
    expect(sent).toMatch(/- C:\\a\.png/)
  })

  it('forwards reasoning and title to createAndAwaitFirstTurn', async () => {
    const spy = vi.fn().mockResolvedValue({ conversationId: 'c1', messageId: 'm1', text: ENVELOPE_REPLY })
    const ctx = makeCtx(spy)
    await aiAgentConversationExecutor.run(
      {
        nodeId: 'n1',
        config: { profileId: 'p', reasoning: 'high', prompt: 'go', titleTemplate: 'Run X' },
        upstream: {},
        downstream: [],
      },
      ctx,
    )
    expect(spy.mock.calls[0]![0].reasoning).toBe('high')
    expect(spy.mock.calls[0]![0].title).toBe('Run X')

    spy.mockClear()
    await aiAgentConversationExecutor.run(
      {
        nodeId: 'n1',
        config: { profileId: 'p', prompt: 'go' },
        upstream: {},
        downstream: [],
      },
      ctx,
    )
    expect(spy.mock.calls[0]![0].title).toBe('Workflow · n1')
  })
})
