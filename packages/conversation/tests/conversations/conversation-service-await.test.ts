import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TypedEmitter, type AgentEventMap } from '@anubis/ai-agent'
import { openDatabase } from '../../src/db/client.js'
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
import { ProfileHomeRegistry } from '../../src/profiles/profile-home.js'
import { SkillLoader } from '../../src/skills/loader.js'
import { SseBroadcaster } from '../../src/sse/broadcaster.js'
import { CronService } from '../../src/cron/cron-service.js'
import { TaskManager } from '../../src/conversations/task-manager.js'
import { ConversationService } from '../../src/conversations/conversation-service.js'
import { CREDENTIAL_FILE } from '../../src/profiles/agent-home.js'

import { AppConfigService } from '../../src/config/app-config.js'
import { ProjectsRepo } from '../../src/db/repositories/projects-repo.js'

function plantCreds(agentHomeRoot: string, profileId: string, agent: 'claude' | 'codex'): void {
  const home = join(agentHomeRoot, profileId, agent)
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, CREDENTIAL_FILE[agent]), '{"token":"test"}')
}

function setupWith(drive: (em: TypedEmitter<AgentEventMap>) => void) {
  const db = openDatabase(':memory:')
  runMigrations(db, MIGRATIONS)
  const agentHomeRoot = mkdtempSync(join(tmpdir(), 'anubis-test-homes-'))
  const profileHomes = new ProfileHomeRegistry(agentHomeRoot)
  const profiles = new ProfileService(new ProfilesRepo(db), profileHomes)
  profiles.seedBuiltins()
  const loader = {
    discoverAll: () => [],
    byName: () => undefined,
    reload: () => undefined,
  } as unknown as SkillLoader

  const aiAgent = {
    streamAgent: vi.fn(async () => {
      const e = new TypedEmitter<AgentEventMap>()
      setTimeout(() => drive(e), 0)
      return { stream: e, workspaceId: 'w', sessionId: 's', agentSessionId: 'asid-1' }
    }),
    runAgent: vi.fn(async () => {
      return { ok: true, text: 'improved prompt' }
    }),
  }
  const tm = new TaskManager(aiAgent as never, { idleMs: 60_000 })
  const sse = new SseBroadcaster()
  const cron = new CronService({
    repo: new CronJobsRepo(db),
    fire: async () => undefined,
    scheduler: { schedule: () => ({ stop: () => undefined, start: () => undefined }) },
  })
  const workspacesRoot = mkdtempSync(join(tmpdir(), 'anubis-test-workspaces-'))
  plantCreds(agentHomeRoot, 'claude-coding', 'claude')
  const appConfig = new AppConfigService(agentHomeRoot)
  const svc = new ConversationService({
    db,
    profiles, skills: loader, sse, cron, tm, aiAgent: aiAgent as never,
    conversations: new ConversationsRepo(db),
    messages: new MessagesRepo(db),
    artifacts: new ArtifactsRepo(db),
    sessions: new AgentSessionsRepo(db),
    knownWorkspaces: new KnownWorkspacesRepo(db),
    projects: new ProjectsRepo(db),
    profileHomes,
    workspacesRoot,
    appConfig,
  })
  return { svc, agentHomeRoot, workspacesRoot }
}

describe('createAndAwaitFirstTurn', () => {
  let cleanup: Array<() => void> = []
  beforeEach(() => { cleanup = [] })

  it('returns the assistant text after the first turn completes', async () => {
    const { svc, agentHomeRoot, workspacesRoot } = setupWith((em) => {
      em.emit('partial', { deltaText: 'hello ' })
      em.emit('partial', { deltaText: 'world' })
      em.emit('done', { finishReason: 'stop' })
    })
    cleanup.push(
      () => rmSync(agentHomeRoot, { recursive: true, force: true }),
      () => rmSync(workspacesRoot, { recursive: true, force: true }),
    )
    try {
      const result = await svc.createAndAwaitFirstTurn({
        title: 'test',
        profileId: 'claude-coding',
        content: 'say hi',
      })
      expect(result.text).toBe('hello world')
      expect(result.conversationId).toMatch(/.+/)
      expect(result.messageId).toMatch(/.+/)
    } finally {
      cleanup.forEach((fn) => fn())
    }
  })

  it('throws on agent error', async () => {
    const { svc, agentHomeRoot, workspacesRoot } = setupWith((em) => {
      em.emit('error', { error: new Error('boom') })
    })
    cleanup.push(
      () => rmSync(agentHomeRoot, { recursive: true, force: true }),
      () => rmSync(workspacesRoot, { recursive: true, force: true }),
    )
    try {
      await expect(
        svc.createAndAwaitFirstTurn({
          title: 'test', profileId: 'claude-coding', content: 'hi',
        }),
      ).rejects.toThrow(/boom/)
    } finally {
      cleanup.forEach((fn) => fn())
    }
  })

  it('cancels when signal aborts mid-turn', async () => {
    const ctl = new AbortController()
    const { svc, agentHomeRoot, workspacesRoot } = setupWith((_em) => {
      setTimeout(() => ctl.abort(), 20)
      // never emit 'done' — only abort triggers resolution
    })
    cleanup.push(
      () => rmSync(agentHomeRoot, { recursive: true, force: true }),
      () => rmSync(workspacesRoot, { recursive: true, force: true }),
    )
    try {
      await expect(
        svc.createAndAwaitFirstTurn({
          title: 'test', profileId: 'claude-coding', content: 'hi', signal: ctl.signal,
        }),
      ).rejects.toThrow(/cancelled/)
    } finally {
      cleanup.forEach((fn) => fn())
    }
  })
})
