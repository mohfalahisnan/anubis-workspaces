import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase, type Db } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { ConversationsRepo } from '../../src/db/repositories/conversations-repo.js'
import { MessagesRepo } from '../../src/db/repositories/messages-repo.js'
import { ArtifactsRepo } from '../../src/db/repositories/artifacts-repo.js'
import { AgentSessionsRepo } from '../../src/db/repositories/agent-sessions-repo.js'

function setup(): { db: Db; convs: ConversationsRepo; msgs: MessagesRepo; arts: ArtifactsRepo; ses: AgentSessionsRepo } {
  const db = openDatabase(':memory:')
  runMigrations(db, MIGRATIONS)
  return {
    db,
    convs: new ConversationsRepo(db),
    msgs: new MessagesRepo(db),
    arts: new ArtifactsRepo(db),
    ses: new AgentSessionsRepo(db),
  }
}

describe('repositories', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => { ctx = setup() })

  it('Conversations insert/find/list/softDelete', () => {
    ctx.convs.insert({
      id: 'c1', title: 'X', agent: 'claude', status: 'pending',
      workspacePath: '/tmp', extra: { skills: [] },
      createdAt: 1, updatedAt: 1,
    })
    expect(ctx.convs.findById('c1')!.title).toBe('X')
    expect(ctx.convs.list({ limit: 10 }).length).toBe(1)
    ctx.convs.softDelete('c1')
    expect(ctx.convs.findById('c1')).toBeNull()
  })

  it('Messages insert + upsertAssistant accumulates content', () => {
    ctx.convs.insert({
      id: 'c1', title: 'X', agent: 'claude', status: 'pending',
      workspacePath: '/tmp', extra: { skills: [] }, createdAt: 1, updatedAt: 1,
    })
    ctx.msgs.upsertAssistant({
      id: 'm1', conversationId: 'c1', msgId: 'mid1', role: 'assistant',
      content: 'one', createdAt: 1,
    })
    ctx.msgs.upsertAssistant({
      id: 'm1', conversationId: 'c1', msgId: 'mid1', role: 'assistant',
      content: 'one two', createdAt: 1,
    })
    expect(ctx.msgs.findById('m1')!.content).toBe('one two')
  })

  it('Artifacts insert + updateResult by call_id', () => {
    ctx.convs.insert({
      id: 'c1', title: 'X', agent: 'claude', status: 'pending',
      workspacePath: '/tmp', extra: { skills: [] }, createdAt: 1, updatedAt: 1,
    })
    ctx.arts.insert({
      id: 'a1', conversationId: 'c1', kind: 'tool_call',
      toolName: 'Read', callId: 'call_1', status: 'running',
      createdAt: 1, updatedAt: 1,
    })
    ctx.arts.updateResult('call_1', 'c1', { ok: true }, 'success')
    expect(ctx.arts.findById('a1')!.status).toBe('success')
  })

  it('AgentSessions upsert is idempotent on conversation_id', () => {
    ctx.convs.insert({
      id: 'c1', title: 'X', agent: 'claude', status: 'pending',
      workspacePath: '/tmp', extra: { skills: [] }, createdAt: 1, updatedAt: 1,
    })
    ctx.ses.upsert({ conversationId: 'c1', agent: 'claude', agentSessionId: 's1', updatedAt: 1 })
    ctx.ses.upsert({ conversationId: 'c1', agent: 'claude', agentSessionId: 's2', updatedAt: 2 })
    expect(ctx.ses.findByConversation('c1')!.agentSessionId).toBe('s2')
  })
})

describe('ConversationsRepo.list source visibility', () => {
  function seed() {
    const db = openDatabase(':memory:')
    runMigrations(db, MIGRATIONS)
    const repo = new ConversationsRepo(db)
    const base = {
      agent: 'codex' as const, status: 'finished' as const,
      workspacePath: '/w', createdAt: 1, updatedAt: 1,
    }
    repo.insert({ ...base, id: 'm1', title: 'manual', extra: { skills: [] } })
    repo.insert({ ...base, id: 'w1', title: 'wf', extra: { skills: [], source: 'workflow' } })
    repo.insert({ ...base, id: 'g1', title: 'gen', extra: { skills: [], source: 'content-generation' } })
    return repo
  }

  it('excludes content-generation when no source filter is passed', () => {
    const ids = seed().list({ limit: 50 }).map((c) => c.id)
    expect(ids).toContain('m1')
    expect(ids).toContain('w1')
    expect(ids).not.toContain('g1')
  })

  it('returns only content-generation when filtered explicitly', () => {
    const ids = seed().list({ limit: 50, source: 'content-generation' }).map((c) => c.id)
    expect(ids).toEqual(['g1'])
  })

  it('still filters manual and workflow exactly', () => {
    const repo = seed()
    expect(repo.list({ limit: 50, source: 'manual' }).map((c) => c.id)).toEqual(['m1'])
    expect(repo.list({ limit: 50, source: 'workflow' }).map((c) => c.id)).toEqual(['w1'])
  })
})
