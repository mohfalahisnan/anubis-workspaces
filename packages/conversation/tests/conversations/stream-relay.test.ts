import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TypedEmitter, type AgentEventMap } from '@anubis/ai-agent'
import { openDatabase, type Db } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { ConversationsRepo } from '../../src/db/repositories/conversations-repo.js'
import { MessagesRepo } from '../../src/db/repositories/messages-repo.js'
import { ArtifactsRepo } from '../../src/db/repositories/artifacts-repo.js'
import { AgentSessionsRepo } from '../../src/db/repositories/agent-sessions-repo.js'
import { SseBroadcaster } from '../../src/sse/broadcaster.js'
import { StreamRelay } from '../../src/conversations/stream-relay.js'

interface SeenEvent { name: string; data: unknown }

function mkRelay(db: Db, sse: SseBroadcaster, cronHandler: (cmd: unknown, id: string) => Promise<string>): StreamRelay {
  return new StreamRelay({
    conversationId: 'c1', msgId: 'm1', messageRowId: 'row1',
    conversations: new ConversationsRepo(db),
    messages: new MessagesRepo(db),
    artifacts: new ArtifactsRepo(db),
    sessions: new AgentSessionsRepo(db),
    sse,
    cronHandler: cronHandler as never,
    flushEvery: 1,
  })
}

describe('StreamRelay', () => {
  let db: Db
  beforeEach(() => {
    db = openDatabase(':memory:')
    runMigrations(db, MIGRATIONS)
    new ConversationsRepo(db).insert({
      id: 'c1', title: 'X', agent: 'claude', status: 'running',
      workspacePath: '/tmp', extra: { skills: [] }, createdAt: 1, updatedAt: 1,
    })
  })

  it('accumulates partials into one assistant message row and emits to SSE', async () => {
    const sse = new SseBroadcaster()
    const seen: SeenEvent[] = []
    sse.subscribe('c1', e => seen.push(e))
    const relay = mkRelay(db, sse, async () => 'no-op')
    const em = new TypedEmitter<AgentEventMap>()
    const done = relay.attach(em)
    em.emit('partial', { deltaText: 'Hello ' })
    em.emit('partial', { deltaText: 'world' })
    em.emit('done', { finishReason: 'stop' })
    await done
    const msg = new MessagesRepo(db).findById('row1')!
    expect(msg.content).toBe('Hello world')
    expect(seen.some(e => e.name === 'partial')).toBe(true)
    expect(seen.some(e => e.name === 'done')).toBe(true)
  })

  it('stores tool_call as artifact and updates on tool_result', async () => {
    const sse = new SseBroadcaster()
    const relay = mkRelay(db, sse, async () => 'no-op')
    const em = new TypedEmitter<AgentEventMap>()
    const done = relay.attach(em)
    em.emit('tool_call', { name: 'Read', args: { path: '/x' } })
    em.emit('tool_result', { name: 'Read', result: { ok: true } })
    em.emit('done', { finishReason: 'stop' })
    await done
    const arts = new ArtifactsRepo(db).listForConversation('c1')
    expect(arts).toHaveLength(1)
    expect(arts[0]!.status).toBe('success')
  })

  it('runs cron handler at done when text contains [CRON_LIST]', async () => {
    const sse = new SseBroadcaster()
    const cron = vi.fn(async () => 'OK')
    const relay = mkRelay(db, sse, cron as never)
    const em = new TypedEmitter<AgentEventMap>()
    const done = relay.attach(em)
    em.emit('partial', { deltaText: '[CRON_LIST]' })
    em.emit('done', { finishReason: 'stop' })
    await done
    expect(cron).toHaveBeenCalledTimes(1)
  })

  it('error event marks conversation status=error', async () => {
    const sse = new SseBroadcaster()
    const relay = mkRelay(db, sse, async () => '')
    const em = new TypedEmitter<AgentEventMap>()
    const done = relay.attach(em)
    em.emit('error', { error: new Error('boom') })
    await done
    const c = new ConversationsRepo(db).findById('c1')!
    expect(c.status).toBe('error')
  })
})
