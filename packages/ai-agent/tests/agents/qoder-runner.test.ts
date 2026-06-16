import { describe, it, expect, vi } from 'vitest'

// Mock the Qoder SDK so the runner consumes a scripted message stream.
const fakeAuth = { type: 'accessToken', accessToken: 'k' }
let scriptedMessages: unknown[] = []

vi.mock('@qoder-ai/qoder-agent-sdk', () => ({
  query: vi.fn(() => {
    async function* gen() {
      for (const m of scriptedMessages) yield m
    }
    return gen()
  }),
  accessToken: vi.fn(() => fakeAuth),
  accessTokenFromEnv: vi.fn(() => fakeAuth),
  qodercliAuth: vi.fn(() => fakeAuth),
}))

import { QoderAgent } from '../../src/agents/qoder/runner.js'
import type { AgentEventMap } from '../../src/events/stream.js'

/** Resolve with the first terminal event the runner emits. */
function awaitTerminal(emitter: {
  on: <K extends keyof AgentEventMap>(e: K, fn: (d: AgentEventMap[K]) => void) => void
}): Promise<{ type: 'done' | 'error'; data: unknown }> {
  return new Promise((resolve) => {
    emitter.on('done', (data) => resolve({ type: 'done', data }))
    emitter.on('error', (data) => resolve({ type: 'error', data }))
  })
}

describe('QoderAgent run — result error handling', () => {
  it('emits `error` (not `done`) when the SDK reports an is_error result', async () => {
    // The Qoder SDK surfaces a rejected/invalid API key as a `result` message
    // with subtype:"error_during_execution", is_error:true, errors:[...] — it
    // does NOT throw. The runner must translate that into an `error` event so
    // the failure renders, instead of a silent "finished" turn.
    scriptedMessages = [
      {
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        errors: ['Authentication failed: invalid access token'],
      },
    ]

    const agent = new QoderAgent()
    const { emitter } = await agent.run({ workspaceId: 'w', cwd: '/tmp', prompt: 'hi', apiKey: 'bad' })

    const terminal = await awaitTerminal(emitter)
    expect(terminal.type).toBe('error')
    expect((terminal.data as { error: Error }).error.message).toContain('invalid access token')
  })

  it('emits `done` on a successful result', async () => {
    scriptedMessages = [
      { type: 'result', subtype: 'success', is_error: false, result: 'ok' },
    ]

    const agent = new QoderAgent()
    const { emitter } = await agent.run({ workspaceId: 'w', cwd: '/tmp', prompt: 'hi', apiKey: 'good' })

    const terminal = await awaitTerminal(emitter)
    expect(terminal.type).toBe('done')
  })
})
