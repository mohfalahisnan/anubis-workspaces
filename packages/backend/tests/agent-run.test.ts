import { describe, expect, it, vi } from 'vitest'
import { runProfileAgent } from '../src/agent-run.js'

function fakeStack(over: Record<string, unknown> = {}) {
  return {
    profiles: { resolve: vi.fn(() => ({ agent: 'codex', model: 'gpt-5.4' })) },
    profileHomes: { for: vi.fn(() => ({ hasCredentials: () => true, env: () => ({ CODEX_HOME: '/h' }) })) },
    appConfig: { get: () => ({ qoderApiKey: undefined }) },
    ...over,
  } as never
}

describe('runProfileAgent', () => {
  it('resolves the profile and runs the agent, returning text + agent', async () => {
    const agentService = { runAgent: vi.fn(async () => ({ text: 'ok' })) } as never
    const res = await runProfileAgent(fakeStack(), agentService, { profileId: 'codex-image', prompt: 'hi', cwd: process.cwd() })
    expect(res).toEqual({ text: 'ok', agent: 'codex' })
    const input = (agentService as { runAgent: { mock: { calls: unknown[][] } } }).runAgent.mock.calls[0]![0] as Record<string, unknown>
    expect(input.agent).toBe('codex')
    expect(input.model).toBe('gpt-5.4')
    expect(input.approvalPolicy).toBe('never')
  })

  it('rejects a web-agent profile', async () => {
    const stack = fakeStack({ profiles: { resolve: vi.fn(() => ({ agent: 'gpt-web' })) } })
    const agentService = { runAgent: vi.fn() } as never
    await expect(runProfileAgent(stack, agentService, { profileId: 'gpt-web-default', prompt: 'x', cwd: process.cwd() }))
      .rejects.toThrow(/web agent/i)
  })

  it('rejects a profile with no credentials', async () => {
    const stack = fakeStack({ profileHomes: { for: vi.fn(() => ({ hasCredentials: () => false, env: () => ({}) })) } })
    const agentService = { runAgent: vi.fn() } as never
    await expect(runProfileAgent(stack, agentService, { profileId: 'codex-image', prompt: 'x', cwd: process.cwd() }))
      .rejects.toThrow(/credentials/i)
  })
})
