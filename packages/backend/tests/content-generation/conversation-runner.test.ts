import { describe, expect, it, vi } from 'vitest'
import { runGenerationAgent } from '../../src/content-generation/conversation-runner.js'

function fakeStack(over: Record<string, unknown> = {}) {
  const created: Array<Record<string, unknown>> = []
  const conversations = new Map<string, { id: string }>()
  return {
    created,
    stack: {
      profiles: { resolve: vi.fn(() => ({ agent: 'codex' })) },
      conversation: {
        get: vi.fn((id: string) => conversations.get(id) ?? null),
        create: vi.fn((input: Record<string, unknown>) => {
          const conv = { id: `conv-${created.length + 1}` }
          created.push(input)
          conversations.set(conv.id, conv)
          return conv
        }),
        sendMessageAndAwait: vi.fn(async () => ({ messageId: 'm', text: 'ok' })),
      },
      ...over,
    },
  }
}

describe('runGenerationAgent', () => {
  it('creates a tagged conversation, persists its id, and runs a turn', async () => {
    const { stack, created } = fakeStack()
    const onConversation = vi.fn()
    const res = await runGenerationAgent(stack as never, {
      profileId: 'codex-image', prompt: 'draw', cwd: '/tmp/assets', title: 'Image · c1', onConversation,
    })
    expect(res.conversationId).toBe('conv-1')
    expect(res.text).toBe('ok')
    expect(res.agent).toBe('codex')
    expect(created[0]).toMatchObject({ source: 'content-generation', workspacePath: '/tmp/assets', profileId: 'codex-image' })
    expect(onConversation).toHaveBeenCalledWith('conv-1')
    expect(stack.conversation.sendMessageAndAwait).toHaveBeenCalledWith('conv-1', { content: 'draw' })
  })

  it('reuses an existing conversation on retry (no new create, no onConversation)', async () => {
    const { stack } = fakeStack()
    // Pre-seed an existing conversation id.
    stack.conversation.get = vi.fn((id: string) => (id === 'existing' ? { id } : null))
    const onConversation = vi.fn()
    const res = await runGenerationAgent(stack as never, {
      profileId: 'codex-image', prompt: 'redraw', cwd: '/tmp/assets', title: 'Image · c1',
      conversationId: 'existing', onConversation,
    })
    expect(res.conversationId).toBe('existing')
    expect(stack.conversation.create).not.toHaveBeenCalled()
    expect(onConversation).not.toHaveBeenCalled()
    expect(stack.conversation.sendMessageAndAwait).toHaveBeenCalledWith('existing', { content: 'redraw' })
  })

  it('rejects web-agent profiles', async () => {
    const { stack } = fakeStack({ profiles: { resolve: vi.fn(() => ({ agent: 'gpt-web' })) } })
    await expect(runGenerationAgent(stack as never, {
      profileId: 'gpt-web-x', prompt: 'draw', cwd: '/tmp/assets', title: 'Image · c1',
    })).rejects.toThrow(/web agent/i)
  })
})
