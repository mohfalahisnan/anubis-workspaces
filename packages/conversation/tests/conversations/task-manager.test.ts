import { describe, it, expect, vi } from 'vitest'
import { TypedEmitter, type AgentEventMap } from '@anubis/ai-agent'
import { TaskManager } from '../../src/conversations/task-manager.js'

function makeFakeService() {
  const emitters: TypedEmitter<AgentEventMap>[] = []
  const streamAgent = vi.fn(async () => {
    const emitter = new TypedEmitter<AgentEventMap>()
    emitters.push(emitter)
    return { stream: emitter, workspaceId: 'w', sessionId: 's', agentSessionId: 'asid-1' }
  })
  return { svc: { streamAgent }, emitters }
}

describe('TaskManager', () => {
  it('getOrBuild reuses the task on second call', async () => {
    const { svc } = makeFakeService()
    const tm = new TaskManager(svc as never, { idleMs: 10_000 })
    const conv = { id: 'c1', agent: 'claude' as const, workspacePath: '/tmp' }
    const profile = { agent: 'claude' as const }
    const t1 = await tm.getOrBuild(conv, profile, { prompt: 'hi', msgId: 'm1' })
    const t2 = await tm.getOrBuild(conv, profile, { prompt: 'again', msgId: 'm2' })
    expect(t1).toBe(t2)
    await tm.kill('c1', 'user')
    await tm.shutdown()
  })

  it('concurrent getOrBuild only spawns once', async () => {
    const { svc } = makeFakeService()
    const tm = new TaskManager(svc as never, { idleMs: 10_000 })
    const conv = { id: 'c1', agent: 'claude' as const, workspacePath: '/tmp' }
    const profile = { agent: 'claude' as const }
    const [a, b] = await Promise.all([
      tm.getOrBuild(conv, profile, { prompt: 'x', msgId: 'm1' }),
      tm.getOrBuild(conv, profile, { prompt: 'y', msgId: 'm2' }),
    ])
    expect(a).toBe(b)
    expect(svc.streamAgent).toHaveBeenCalledTimes(1)
    await tm.shutdown()
  })

  it('subscribe returns the task emitter when task is live', async () => {
    const { svc } = makeFakeService()
    const tm = new TaskManager(svc as never, { idleMs: 10_000 })
    const conv = { id: 'c1', agent: 'claude' as const, workspacePath: '/tmp' }
    const profile = { agent: 'claude' as const }
    await tm.getOrBuild(conv, profile, { prompt: 'hi', msgId: 'm1' })
    expect(tm.subscribe('c1')).not.toBeNull()
    expect(tm.subscribe('missing')).toBeNull()
    await tm.shutdown()
  })

  it('kill removes the task', async () => {
    const { svc } = makeFakeService()
    const tm = new TaskManager(svc as never, { idleMs: 10_000 })
    const conv = { id: 'c1', agent: 'claude' as const, workspacePath: '/tmp' }
    const profile = { agent: 'claude' as const }
    await tm.getOrBuild(conv, profile, { prompt: 'hi', msgId: 'm1' })
    await tm.kill('c1', 'user')
    expect(tm.subscribe('c1')).toBeNull()
    await tm.shutdown()
  })
})
