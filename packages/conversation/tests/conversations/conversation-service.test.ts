import { describe, it, expect, beforeEach, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TypedEmitter, type AgentEventMap } from '@anubis/ai-agent'
import { openDatabase, type Db } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { ProfilesRepo } from '../../src/db/repositories/profiles-repo.js'
import { ConversationsRepo } from '../../src/db/repositories/conversations-repo.js'
import { MessagesRepo } from '../../src/db/repositories/messages-repo.js'
import { ArtifactsRepo } from '../../src/db/repositories/artifacts-repo.js'
import { AgentSessionsRepo } from '../../src/db/repositories/agent-sessions-repo.js'
import { KnownWorkspacesRepo } from '../../src/db/repositories/known-workspaces-repo.js'
import { CronJobsRepo } from '../../src/db/repositories/cron-jobs-repo.js'
import { ProfileService } from '../../src/profiles/profile-service.js'
import { SkillLoader } from '../../src/skills/loader.js'
import { SseBroadcaster } from '../../src/sse/broadcaster.js'
import { CronService } from '../../src/cron/cron-service.js'
import { TaskManager } from '../../src/conversations/task-manager.js'
import { ConversationService, NoCredentialsError } from '../../src/conversations/conversation-service.js'
import { CREDENTIAL_FILE } from '../../src/profiles/agent-home.js'

function plantCreds(agentHomeRoot: string, profileId: string, agent: 'claude' | 'codex'): void {
  const home = join(agentHomeRoot, profileId, agent)
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, CREDENTIAL_FILE[agent]), '{"token":"test"}')
}

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
  const agentHomeRoot = mkdtempSync(join(tmpdir(), 'anubis-test-homes-'))
  const workspacesRoot = mkdtempSync(join(tmpdir(), 'anubis-test-workspaces-'))
  const svc = new ConversationService({
    db,
    profiles, skills: loader, sse, cron, tm, aiAgent: aiAgent as never,
    conversations: new ConversationsRepo(db),
    messages: new MessagesRepo(db),
    artifacts: new ArtifactsRepo(db),
    sessions: new AgentSessionsRepo(db),
    knownWorkspaces: new KnownWorkspacesRepo(db),
    agentHomeRoot,
    workspacesRoot,
  })
  return { svc, profiles, db, aiAgent, tm, sse, agentHomeRoot, workspacesRoot }
}

describe('ConversationService', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => { ctx = setup() })

  it('records an explicitly chosen workspace but not an auto temp dir', () => {
    const { svc, db, workspacesRoot } = setup()
    const real = mkdtempSync(join(tmpdir(), 'anubis-real-ws-'))
    // Explicit real folder → recorded.
    svc.create({ title: 't', profileId: 'claude-coding', workspacePath: real })
    // No workspacePath → backend auto-creates one under workspacesRoot → NOT recorded.
    svc.create({ title: 't2', profileId: 'claude-coding' })
    const known = new KnownWorkspacesRepo(db).list().map((w) => w.path)
    expect(known).toContain(real)
    expect(known.some((p) => p.startsWith(workspacesRoot))).toBe(false)
  })

  it('create stores skills snapshot and profile id', () => {
    const c = ctx.svc.create({ title: 'T', profileId: 'claude-coding', workspacePath: '/tmp' })
    expect(c.profileId).toBe('claude-coding')
    expect(c.extra.skills).toEqual([])
  })

  it('marks and filters conversations created by workflows', () => {
    const manual = ctx.svc.create({ title: 'Manual', profileId: 'claude-coding', workspacePath: '/tmp/manual' })
    const workflow = ctx.svc.create({
      title: 'Workflow',
      profileId: 'claude-coding',
      workspacePath: '/tmp/workflow',
      source: 'workflow',
      workflow: { runId: 'run-1', nodeId: 'ai-1' },
    })

    expect(workflow.extra.source).toBe('workflow')
    expect(workflow.extra.workflow).toEqual({ runId: 'run-1', nodeId: 'ai-1' })
    expect(ctx.svc.list({ source: 'manual' }).map((c) => c.id)).toEqual([manual.id])
    expect(ctx.svc.list({ source: 'workflow' }).map((c) => c.id)).toEqual([workflow.id])
  })

  it('create auto-fills workspacePath when omitted', () => {
    const c = ctx.svc.create({ title: 'T', profileId: 'claude-coding' })
    expect(c.workspacePath.startsWith(ctx.workspacesRoot)).toBe(true)
    expect(c.workspacePath.endsWith(c.id)).toBe(true)
    expect(existsSync(c.workspacePath)).toBe(true)
  })

  it('create honors an explicit workspacePath', () => {
    const c = ctx.svc.create({ title: 'T', profileId: 'claude-coding', workspacePath: '/tmp/custom' })
    expect(c.workspacePath).toBe('/tmp/custom')
  })

  it('create rejects when agent cannot be determined', () => {
    expect(() => ctx.svc.create({ title: 'T', workspacePath: '/tmp' })).toThrow(/agent/i)
  })

  it('sendMessage throws NoCredentialsError when the profile home lacks credentials', async () => {
    const c = ctx.svc.create({ title: 'T', profileId: 'claude-coding', workspacePath: '/tmp' })
    await expect(ctx.svc.sendMessage(c.id, { content: 'hi' }))
      .rejects.toBeInstanceOf(NoCredentialsError)
  })

  it('sendMessage inserts user row and starts a turn', async () => {
    plantCreds(ctx.agentHomeRoot, 'claude-coding', 'claude')
    const c = ctx.svc.create({ title: 'T', profileId: 'claude-coding', workspacePath: '/tmp' })
    const r = await ctx.svc.sendMessage(c.id, { content: 'hello' })
    expect(r.msgId).toBeTruthy()
    await new Promise(rs => setTimeout(rs, 20))
    const msgs = ctx.svc.listMessages(c.id)
    expect(msgs.some(m => m.role === 'user' && m.content === 'hello')).toBe(true)
    await ctx.tm.shutdown()
  })

  it('sendMessage stores fileReferences in message metadata and passes to task manager', async () => {
    plantCreds(ctx.agentHomeRoot, 'claude-coding', 'claude')
    const c = ctx.svc.create({ title: 'T', profileId: 'claude-coding', workspacePath: '/tmp' })
    const files = ['/tmp/file1.txt', 'file2.js']
    const r = await ctx.svc.sendMessage(c.id, { content: 'hello with files', fileReferences: files })
    expect(r.msgId).toBeTruthy()
    await new Promise(rs => setTimeout(rs, 20))
    const msgs = ctx.svc.listMessages(c.id)
    const userMsg = msgs.find(m => m.role === 'user' && m.content === 'hello with files')
    expect(userMsg).toBeTruthy()
    expect(userMsg?.metadata?.fileReferences).toEqual(files)

    const call = ctx.aiAgent.streamAgent.mock.calls[ctx.aiAgent.streamAgent.mock.calls.length - 1]?.[0] as { files?: string[] }
    expect(call?.files).toBeTruthy()
    expect(call?.files).toContain('/tmp/file1.txt')
    expect(call?.files?.some(f => f.endsWith('file2.js'))).toBe(true)

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

  it('cancel forces a terminal status and a done SSE even when the stream never ends', async () => {
    plantCreds(ctx.agentHomeRoot, 'claude-coding', 'claude')
    const c = ctx.svc.create({ title: 'T', profileId: 'claude-coding', workspacePath: '/tmp' })

    // A stream that never emits a terminal — simulates a hung agent process.
    const cancelSpy = vi.fn(async () => {})
    ctx.aiAgent.streamAgent.mockImplementation(async () => ({
      stream: new TypedEmitter<AgentEventMap>(),
      workspaceId: 'w',
      sessionId: 's',
      agentSessionId: 'asid-1',
      cancel: cancelSpy,
    }))

    await ctx.svc.sendMessage(c.id, { content: 'hi' })
    expect(ctx.svc.get(c.id)?.status).toBe('running')

    const events: Array<{ name: string }> = []
    const sub = ctx.sse.subscribe(c.id, (e) => events.push(e))

    await ctx.svc.cancel(c.id)

    // The spawned run was actually cancelled...
    expect(cancelSpy).toHaveBeenCalledTimes(1)
    // ...the conversation reaches a terminal status (a clean stop, not error)...
    expect(ctx.svc.get(c.id)?.status).toBe('finished')
    // ...and a terminal `done` reached the UI so it can clear its streaming state.
    expect(events.some((e) => e.name === 'done')).toBe(true)

    sub.unsubscribe()
    await ctx.tm.shutdown()
  })

  it('sendMessage auto-creates the profile agent home and injects CLAUDE_CONFIG_DIR', async () => {
    plantCreds(ctx.agentHomeRoot, 'claude-coding', 'claude')
    const c = ctx.svc.create({ title: 'T', profileId: 'claude-coding', workspacePath: '/tmp' })
    await ctx.svc.sendMessage(c.id, { content: 'hi' })
    await new Promise((rs) => setTimeout(rs, 20))

    const expectedHome = join(ctx.agentHomeRoot, 'claude-coding', 'claude')
    expect(existsSync(expectedHome)).toBe(true)

    const call = ctx.aiAgent.streamAgent.mock.calls[0]?.[0] as { extraEnv?: Record<string, string> }
    expect(call?.extraEnv?.CLAUDE_CONFIG_DIR).toBe(expectedHome)

    await ctx.tm.shutdown()
  })

  it('sendMessage writes profile instructions to CLAUDE.md and AGENTS.md (not per-turn)', async () => {
    plantCreds(ctx.agentHomeRoot, 'claude-research', 'claude')
    const c = ctx.svc.create({ title: 'T', profileId: 'claude-research', workspacePath: '/tmp' })
    await ctx.svc.sendMessage(c.id, { content: 'hi' })
    await new Promise((rs) => setTimeout(rs, 20))

    const home = join(ctx.agentHomeRoot, 'claude-research', 'claude')
    const claude = readFileSync(join(home, 'CLAUDE.md'), 'utf8')
    const agents = readFileSync(join(home, 'AGENTS.md'), 'utf8')

    // CLAUDE.md is the single source of truth — must contain the profile's prompt.
    expect(claude).toContain('research mode')
    // AGENTS.md just points to CLAUDE.md (no redundant copy).
    expect(agents).not.toContain('research mode')
    expect(agents.toLowerCase()).toContain('claude.md')

    // appendSystemPrompt MUST NOT be re-sent per turn now that it lives in CLAUDE.md.
    const call = ctx.aiAgent.streamAgent.mock.calls[0]?.[0] as { appendSystemPrompt?: string }
    expect(call?.appendSystemPrompt).toBeUndefined()

    await ctx.tm.shutdown()
  })

  it('sendMessage passes appendSystemPrompt inline for codex and antigravity profiles', async () => {
    plantCreds(ctx.agentHomeRoot, 'codex-coding', 'codex')
    const c = ctx.svc.create({
      title: 'T',
      profileId: 'codex-coding',
      workspacePath: '/tmp',
      override: { appendSystemPrompt: 'Custom Codex instructions' }
    })
    await ctx.svc.sendMessage(c.id, { content: 'hi' })
    await new Promise((rs) => setTimeout(rs, 20))

    const call = ctx.aiAgent.streamAgent.mock.calls[ctx.aiAgent.streamAgent.mock.calls.length - 1]?.[0] as { appendSystemPrompt?: string }
    expect(call?.appendSystemPrompt).toContain('Custom Codex instructions')

    await ctx.tm.shutdown()
  })

  it('sendMessage injects CODEX_HOME for codex profiles', async () => {
    plantCreds(ctx.agentHomeRoot, 'codex-coding', 'codex')
    const c = ctx.svc.create({ title: 'T', profileId: 'codex-coding', workspacePath: '/tmp' })
    await ctx.svc.sendMessage(c.id, { content: 'hi' })
    await new Promise((rs) => setTimeout(rs, 20))

    const expectedHome = join(ctx.agentHomeRoot, 'codex-coding', 'codex')
    expect(existsSync(expectedHome)).toBe(true)

    const call = ctx.aiAgent.streamAgent.mock.calls[0]?.[0] as { extraEnv?: Record<string, string> }
    expect(call?.extraEnv?.CODEX_HOME).toBe(expectedHome)
    expect(call?.extraEnv?.CLAUDE_CONFIG_DIR).toBeUndefined()

    await ctx.tm.shutdown()
  })

  it('resetProfileHome removes the directory', () => {
    plantCreds(ctx.agentHomeRoot, 'claude-coding', 'claude')
    ctx.svc.create({ title: 'T', profileId: 'claude-coding', workspacePath: '/tmp' })
    // ensure on first send
    return ctx.svc
      .sendMessage('does-not-exist', { content: 'x' })
      .catch(() => undefined)
      .then(() => {
        // sendMessage on a real conversation now to create the home
        const c2 = ctx.svc.create({ title: 'T2', profileId: 'claude-coding', workspacePath: '/tmp' })
        return ctx.svc.sendMessage(c2.id, { content: 'hi' })
      })
      .then(async () => {
        await new Promise((rs) => setTimeout(rs, 20))
        const home = ctx.svc.agentHomePath('claude-coding', 'claude')
        expect(existsSync(home)).toBe(true)
        const r = ctx.svc.resetProfileHome('claude-coding', 'claude')
        expect(r.existed).toBe(true)
        expect(existsSync(home)).toBe(false)
        // resetProfileHome on an already-clean profile is a no-op
        const r2 = ctx.svc.resetProfileHome('claude-coding', 'claude')
        expect(r2.existed).toBe(false)
        await ctx.tm.shutdown()
      })
  })

  it('cleanup test home dirs', () => {
    rmSync(ctx.agentHomeRoot, { recursive: true, force: true })
  })
})
