import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ProfileSummary, ConversationSummary } from '@anubis/shared'
import { useEnsureConversation } from '@/lib/use-ensure-conversation'

vi.mock('@/api', () => ({
  createConversation: vi.fn(),
}))

import { createConversation } from '@/api'

const PROFILE: ProfileSummary = {
  id: 'p1',
  name: 'Coding',
  source: 'builtin',
  config: { agent: 'claude' },
  sortOrder: 0,
  createdAt: 0,
  updatedAt: 0,
} as ProfileSummary

const NEW_CONV: ConversationSummary = {
  id: 'conv-new',
  title: 't',
  agent: 'claude',
  status: 'pending',
  workspacePath: '/auto',
  extra: { skills: [] },
  createdAt: 0,
  updatedAt: 0,
}

beforeEach(() => {
  vi.mocked(createConversation).mockReset()
})

describe('useEnsureConversation', () => {
  it('returns the existing id when conversationId is set', async () => {
    const { result } = renderHook(() =>
      useEnsureConversation('existing-id', PROFILE, 'medium', 'medium'),
    )
    let returned: string | null = null
    await act(async () => {
      returned = await result.current.ensure('hello')
    })
    expect(returned).toBe('existing-id')
    expect(createConversation).not.toHaveBeenCalled()
  })

  it('creates a conversation when conversationId is undefined', async () => {
    vi.mocked(createConversation).mockResolvedValueOnce(NEW_CONV)
    const { result } = renderHook(() =>
      useEnsureConversation(undefined, PROFILE, 'medium', 'medium'),
    )
    let returned: string | null = null
    await act(async () => {
      returned = await result.current.ensure('say hi to the world')
    })
    expect(returned).toBe('conv-new')
    expect(createConversation).toHaveBeenCalledWith({
      title: 'say hi to the world',
      profileId: 'p1',
      agent: 'claude',
    })
  })

  it('truncates a long first message to 60 chars for the title', async () => {
    vi.mocked(createConversation).mockResolvedValueOnce(NEW_CONV)
    const long = 'a'.repeat(120)
    const { result } = renderHook(() =>
      useEnsureConversation(undefined, PROFILE, 'medium', 'medium'),
    )
    await act(async () => {
      await result.current.ensure(long)
    })
    const call = vi.mocked(createConversation).mock.calls[0]![0]
    expect(call.title).toHaveLength(60)
  })

  it('falls back to "New conversation" for an empty first message', async () => {
    vi.mocked(createConversation).mockResolvedValueOnce(NEW_CONV)
    const { result } = renderHook(() =>
      useEnsureConversation(undefined, PROFILE, 'medium', 'medium'),
    )
    await act(async () => {
      await result.current.ensure('   ')
    })
    const call = vi.mocked(createConversation).mock.calls[0]![0]
    expect(call.title).toBe('New conversation')
  })

  it('includes override only when effort differs from profile default', async () => {
    vi.mocked(createConversation).mockResolvedValueOnce(NEW_CONV)
    const { result } = renderHook(() =>
      useEnsureConversation(undefined, PROFILE, 'high', 'medium'),
    )
    await act(async () => {
      await result.current.ensure('go')
    })
    const call = vi.mocked(createConversation).mock.calls[0]![0]
    expect(call.override).toEqual({ reasoningEffort: 'high' })
  })

  it('omits override when effort matches profile default', async () => {
    vi.mocked(createConversation).mockResolvedValueOnce(NEW_CONV)
    const { result } = renderHook(() =>
      useEnsureConversation(undefined, PROFILE, 'medium', 'medium'),
    )
    await act(async () => {
      await result.current.ensure('go')
    })
    const call = vi.mocked(createConversation).mock.calls[0]![0]
    expect(call.override).toBeUndefined()
  })

  it('reports error when create fails and rejects with the error', async () => {
    vi.mocked(createConversation).mockRejectedValueOnce(new Error('nope'))
    const { result } = renderHook(() =>
      useEnsureConversation(undefined, PROFILE, 'medium', 'medium'),
    )
    let caught: unknown = null
    await act(async () => {
      try { await result.current.ensure('hi') } catch (e) { caught = e }
    })
    expect((caught as Error).message).toBe('nope')
    expect(result.current.error).toBe('nope')
  })

  it('rejects when no profile is selected', async () => {
    const { result } = renderHook(() =>
      useEnsureConversation(undefined, null, 'medium', 'medium'),
    )
    let caught: unknown = null
    await act(async () => {
      try { await result.current.ensure('hi') } catch (e) { caught = e }
    })
    expect((caught as Error).message).toMatch(/no profile/i)
  })
})
