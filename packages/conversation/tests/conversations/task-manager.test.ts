import { describe, it, expect, vi } from 'vitest'
import { TypedEmitter, type AgentEventMap } from '@anubis/ai-agent'
import { TaskManager } from '../../src/conversations/task-manager.js'

function makeFakeService() {
  const emitters: TypedEmitter<AgentEventMap>[] = []
  const cancels: Array<ReturnType<typeof vi.fn>> = []
  const streamAgent = vi.fn(async () => {
    const emitter = new TypedEmitter<AgentEventMap>()
    emitters.push(emitter)
    const cancel = vi.fn(async () => {})
    cancels.push(cancel)
    return { stream: emitter, workspaceId: 'w', sessionId: 's', agentSessionId: 'asid-1', cancel }
  })
  return { svc: { streamAgent }, emitters, cancels }
}

describe('TaskManager', () => {
  it('getOrBuild starts a new task after the previous task is done', async () => {
    const { svc, emitters } = makeFakeService()
    const tm = new TaskManager(svc as never, { idleMs: 10_000 })
    const conv = { id: 'c1', agent: 'claude' as const, workspacePath: '/tmp' }
    const profile = { agent: 'claude' as const }
    const t1 = await tm.getOrBuild(conv, profile, { prompt: 'hi', msgId: 'm1' })
    emitters[0]!.emit('done', { finishReason: 'stop' })
    const t2 = await tm.getOrBuild(conv, profile, { prompt: 'again', msgId: 'm2' })
    expect(t2).not.toBe(t1)
    expect(svc.streamAgent).toHaveBeenCalledTimes(2)
    await tm.kill('c1', 'user')
    await tm.shutdown()
  })

  it('getOrBuild rejects while a task is still running', async () => {
    const { svc } = makeFakeService()
    const tm = new TaskManager(svc as never, { idleMs: 10_000 })
    const conv = { id: 'c1', agent: 'claude' as const, workspacePath: '/tmp' }
    const profile = { agent: 'claude' as const }
    await tm.getOrBuild(conv, profile, { prompt: 'hi', msgId: 'm1' })
    expect(tm.isBusy('c1')).toBe(true)
    await expect(tm.getOrBuild(conv, profile, { prompt: 'again', msgId: 'm2' }))
      .rejects.toThrow(/running agent task/i)
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

  it('kill terminates the underlying agent run, not just the bookkeeping', async () => {
    const { svc, cancels } = makeFakeService()
    const tm = new TaskManager(svc as never, { idleMs: 10_000 })
    const conv = { id: 'c1', agent: 'claude' as const, workspacePath: '/tmp' }
    const profile = { agent: 'claude' as const }
    await tm.getOrBuild(conv, profile, { prompt: 'hi', msgId: 'm1' })
    await tm.kill('c1', 'user')
    // The whole point of Stop: the spawned agent process must actually be
    // cancelled. Deleting the map entry without killing the process leaves a
    // zombie that blocks the next turn from resuming the same session.
    expect(cancels[0]).toHaveBeenCalledTimes(1)
    await tm.shutdown()
  })

  it('kill during the building window tears the run down once it spawns', async () => {
    let resolveStream: (v: unknown) => void = () => {}
    const streamReady = new Promise((r) => { resolveStream = r })
    const cancel = vi.fn(async () => {})
    const emitter = new TypedEmitter<AgentEventMap>()
    const svc = {
      streamAgent: vi.fn(() => streamReady),
    }
    const tm = new TaskManager(svc as never, { idleMs: 10_000 })
    const conv = { id: 'c1', agent: 'claude' as const, workspacePath: '/tmp' }
    const profile = { agent: 'claude' as const }

    // Start the turn but leave it stuck in the building window.
    const buildP = tm.getOrBuild(conv, profile, { prompt: 'hi', msgId: 'm1' })
    // Kill while still building — must NOT be a silent no-op.
    await tm.kill('c1', 'user')
    // Now let the spawn finish.
    resolveStream({ stream: emitter, workspaceId: 'w', sessionId: 's', agentSessionId: 'a', cancel })
    await buildP

    // The spawned run was actually cancelled, and no live task remains.
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(tm.isBusy('c1')).toBe(false)
    expect(tm.subscribe('c1')).toBeNull()
    await tm.shutdown()
  })
})
