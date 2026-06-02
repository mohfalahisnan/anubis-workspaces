import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TypedEmitter, type AgentEventMap } from '@anubis/ai-agent'
import { openDatabase, type Db } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { ProfilesRepo } from '../../src/db/repositories/profiles-repo.js'
import { ConversationsRepo } from '../../src/db/repositories/conversations-repo.js'
import { MessagesRepo } from '../../src/db/repositories/messages-repo.js'
import { ArtifactsRepo } from '../../src/db/repositories/artifacts-repo.js'
import { AgentSessionsRepo } from '../../src/db/repositories/agent-sessions-repo.js'
import { CronJobsRepo } from '../../src/db/repositories/cron-jobs-repo.js'
import { ProfileService } from '../../src/profiles/profile-service.js'
import { SkillLoader } from '../../src/skills/loader.js'
import { SseBroadcaster } from '../../src/sse/broadcaster.js'
import { CronService } from '../../src/cron/cron-service.js'
import { TaskManager } from '../../src/conversations/task-manager.js'
import { ConversationService } from '../../src/conversations/conversation-service.js'

function setup() {
  const db = openDatabase(':memory:')
  runMigrations(db, MIGRATIONS)
  const profiles = new ProfileService(new ProfilesRepo(db))
  profiles.seedBuiltins()
  const loader = {
    discoverAll: () => [],
    byName: () => undefined,
    reload: () => undefined,
  } as unknown as SkillLoader

  const aiAgent = {
    streamAgent: vi.fn(async () => {
      const e = new TypedEmitter<AgentEventMap>()
      setTimeout(() => {
        e.emit('partial', { deltaText: 'ok' })
        e.emit('done', { finishReason: 'stop' })
      }, 0)
      return { stream: e, workspaceId: 'w', sessionId: 's', agentSessionId: 'asid-1' }
    }),
  }
  const tm = new TaskManager(aiAgent as never, { idleMs: 60_000 })
  const sse = new SseBroadcaster()
  const cron = new CronService({
    repo: new CronJobsRepo(db),
    fire: async () => undefined,
    scheduler: { schedule: () => ({ stop: () => undefined, start: () => undefined }) },
  })
  const svc = new ConversationService({
    db,
    profiles, skills: loader, sse, cron, tm, aiAgent: aiAgent as never,
    conversations: new ConversationsRepo(db),
    messages: new MessagesRepo(db),
    artifacts: new ArtifactsRepo(db),
    sessions: new AgentSessionsRepo(db),
  })
  return { svc, profiles, db, aiAgent, tm }
}

describe('ConversationService', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => { ctx = setup() })

  it('create stores skills snapshot and profile id', () => {
    const c = ctx.svc.create({ title: 'T', profileId: 'claude-coding', workspacePath: '/tmp' })
    expect(c.profileId).toBe('claude-coding')
    expect(c.extra.skills).toEqual([])
  })

  it('create rejects when agent cannot be determined', () => {
    expect(() => ctx.svc.create({ title: 'T', workspacePath: '/tmp' })).toThrow(/agent/i)
  })

  it('sendMessage inserts user row and starts a turn', async () => {
    const c = ctx.svc.create({ title: 'T', profileId: 'claude-coding', workspacePath: '/tmp' })
    const r = await ctx.svc.sendMessage(c.id, { content: 'hello' })
    expect(r.msgId).toBeTruthy()
    await new Promise(rs => setTimeout(rs, 20))
    const msgs = ctx.svc.listMessages(c.id)
    expect(msgs.some(m => m.role === 'user' && m.content === 'hello')).toBe(true)
    await ctx.tm.shutdown()
  })

  it('PATCH rejects changing agent via override', () => {
    const c = ctx.svc.create({ title: 'T', profileId: 'claude-coding', workspacePath: '/tmp' })
    expect(() => ctx.svc.update(c.id, { override: { agent: 'codex' } })).toThrow(/agent/i)
  })

  it('resetSkills recomputes and persists snapshot', () => {
    const c = ctx.svc.create({ title: 'T', profileId: 'claude-coding', workspacePath: '/tmp' })
    const skills = ctx.svc.resetSkills(c.id)
    expect(skills).toEqual([])
  })

  it('delete soft-deletes the conversation', () => {
    const c = ctx.svc.create({ title: 'T', profileId: 'claude-coding', workspacePath: '/tmp' })
    ctx.svc.delete(c.id)
    expect(ctx.svc.get(c.id)).toBeNull()
  })
})
