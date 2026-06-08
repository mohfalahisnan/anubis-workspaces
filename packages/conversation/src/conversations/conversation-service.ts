import { join, relative, isAbsolute } from 'node:path'
import { mkdirSync } from 'node:fs'
import type { AiAgentService } from '@anubis/ai-agent'
import { NO_CREDENTIALS_ERROR_CODE } from '@anubis/shared'
import type { Db } from '../db/client.js'
import { newId } from '../util/ids.js'
import { hasCredentials } from '../profiles/agent-home.js'

export class NoCredentialsError extends Error {
  readonly code = NO_CREDENTIALS_ERROR_CODE
  constructor(public readonly profileId: string, public readonly agent: AgentKind) {
    super(`no credentials for profile ${profileId} (${agent})`)
    this.name = 'NoCredentialsError'
  }
}
import { nowMs } from '../util/time.js'
import { computeInitialSkills } from '../skills/snapshot.js'
import { composeAppendSystemPrompt } from '../skills/inject.js'
import type { SkillLoader } from '../skills/loader.js'
import type { ProfileService } from '../profiles/profile-service.js'
import type { ProfileOverride, ResolvedProfile, AgentKind } from '../profiles/types.js'
import {
  ensureAgentHome,
  envFor,
  homePathFor,
  resetProfileHome,
  writeProfileInstructions,
  writeProfileSkills,
} from '../profiles/agent-home.js'
import type { ConversationsRepo } from '../db/repositories/conversations-repo.js'
import type { MessagesRepo } from '../db/repositories/messages-repo.js'
import type { ArtifactsRepo } from '../db/repositories/artifacts-repo.js'
import type { AgentSessionsRepo } from '../db/repositories/agent-sessions-repo.js'
import type { KnownWorkspacesRepo } from '../db/repositories/known-workspaces-repo.js'
import type { SseBroadcaster } from '../sse/broadcaster.js'
import type { CronService } from '../cron/cron-service.js'
import type { TaskManager } from './task-manager.js'
import type { Conversation, ConversationExtra, Message } from './types.js'
import { StreamRelay } from './stream-relay.js'

export interface CreateConversationInput {
  title: string
  profileId?: string
  projectId?: string
  override?: ProfileOverride
  workspacePath?: string
  agent?: AgentKind
  source?: 'workflow'
  workflow?: { runId: string; nodeId: string }
}

export interface SendMessageInput {
  content: string
  override?: ProfileOverride
}

export interface CreateAndAwaitFirstTurnInput {
  title: string
  profileId: string
  projectId?: string
  override?: ProfileOverride
  content: string
  workspacePath?: string
  signal?: AbortSignal
  source?: 'workflow'
  workflow?: { runId: string; nodeId: string }
}

export interface CreateAndAwaitFirstTurnResult {
  conversationId: string
  messageId: string
  text: string
}

export interface UpdateConversationInput {
  title?: string
  override?: ProfileOverride
  archived?: boolean
  profileId?: string | null
  workspacePath?: string
}

export interface ConversationServiceDeps {
  db: Db
  profiles: ProfileService
  skills: SkillLoader
  sse: SseBroadcaster
  cron: CronService
  tm: TaskManager
  aiAgent: Pick<AiAgentService, 'streamAgent'>
  conversations: ConversationsRepo
  messages: MessagesRepo
  artifacts: ArtifactsRepo
  sessions: AgentSessionsRepo
  knownWorkspaces: KnownWorkspacesRepo
  /**
   * Root directory under which each profile gets its own isolated
   * agent home folder ({agentHomeRoot}/{profileId}/{agent}/).
   * Composition root sets this to {ANUBIS_DATA_DIR}/agent-homes.
   */
  agentHomeRoot: string
  /**
   * Root directory under which auto-generated workspace folders live
   * ({workspacesRoot}/{conversationId}). Used when CreateConversationInput
   * omits workspacePath. Composition root sets this to
   * {ANUBIS_DATA_DIR}/workspaces and ensures it exists.
   */
  workspacesRoot: string
}

export class ConversationService {
  constructor(private deps: ConversationServiceDeps) {}

  create(input: CreateConversationInput): Conversation {
    const resolved = this.resolveOrThrow(input.profileId ?? null, input.override, input.agent)
    const skills = computeInitialSkills(this.deps.skills.discoverAll(), resolved)
    const now = nowMs()
    const id = newId()
    const workspacePath = input.workspacePath ?? join(this.deps.workspacesRoot, id)
    if (!input.workspacePath) {
      mkdirSync(workspacePath, { recursive: true })
    }
    const conv: Conversation = {
      id,
      title: input.title,
      agent: resolved.agent,
      status: 'pending',
      profileId: input.profileId,
      projectId: input.projectId ?? 'default',
      workspacePath,
      extra: {
        skills,
        overrides: input.override,
        source: input.source,
        workflow: input.workflow,
      },
      createdAt: now,
      updatedAt: now,
    }
    this.deps.conversations.insert(conv)
    if (input.workspacePath) this.rememberWorkspace(input.workspacePath)
    if (input.profileId) this.deps.profiles.touchLastUsed(input.profileId)
    return conv
  }

  /**
   * Remember a user-chosen workspace so it can be re-selected later. Skips
   * the throwaway per-conversation scratch dirs the service auto-creates
   * under `workspacesRoot` — only real folders the user picked are kept.
   */
  private rememberWorkspace(path: string): void {
    const rel = relative(this.deps.workspacesRoot, path)
    const isScratch = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
    if (isScratch) return
    this.deps.knownWorkspaces.remember(path)
  }

  list(opts: { limit?: number; archived?: boolean; source?: 'manual' | 'workflow'; projectId?: string } = {}): Conversation[] {
    return this.deps.conversations.list({
      limit: opts.limit ?? 50,
      archived: opts.archived,
      source: opts.source,
      projectId: opts.projectId,
    })
  }

  get(id: string): Conversation | null {
    return this.deps.conversations.findById(id)
  }

  update(id: string, patch: UpdateConversationInput): Conversation {
    const cur = this.deps.conversations.findById(id)
    if (!cur) throw new Error(`Conversation not found: ${id}`)
    if (patch.override?.agent && patch.override.agent !== cur.agent) {
      throw new Error('Cannot change conversation agent after create')
    }
    if (patch.profileId) {
      const p = this.deps.profiles.get(patch.profileId)
      if (!p) throw new Error(`Profile not found: ${patch.profileId}`)
      if (p.config.agent !== cur.agent) throw new Error(`Profile ${patch.profileId} agent (${p.config.agent}) does not match conversation agent (${cur.agent})`)
    }
    const extra: ConversationExtra = {
      ...cur.extra,
      overrides: patch.override ?? cur.extra.overrides,
      archived: patch.archived ?? cur.extra.archived,
    }
    let workspacePath: string | undefined
    if (patch.workspacePath !== undefined) {
      const trimmed = patch.workspacePath.trim()
      if (!trimmed) throw new Error('workspacePath cannot be empty')
      // Auto-create so the spawned CLI doesn't immediately ENOENT into cwd.
      // If the user passed a junk path the underlying mkdir will surface.
      mkdirSync(trimmed, { recursive: true })
      workspacePath = trimmed
    }
    this.deps.conversations.updateFields(id, {
      title: patch.title,
      extra,
      profileId: patch.profileId === undefined ? undefined : patch.profileId,
      workspacePath,
    })
    if (workspacePath) this.rememberWorkspace(workspacePath)
    return this.deps.conversations.findById(id)!
  }

  delete(id: string): void {
    void this.deps.tm.kill(id, 'user')
    this.deps.conversations.softDelete(id)
  }

  resetSkills(id: string): string[] {
    const cur = this.deps.conversations.findById(id)
    if (!cur) throw new Error(`Conversation not found: ${id}`)
    const resolved = this.resolveOrThrow(cur.profileId ?? null, cur.extra.overrides, cur.agent)
    const skills = computeInitialSkills(this.deps.skills.discoverAll(), resolved)
    this.deps.conversations.updateFields(id, { extra: { ...cur.extra, skills } })
    return skills
  }

  listMessages(id: string): Message[] {
    return this.deps.messages.listForConversation(id)
  }

  private async startTurn(
    cur: Conversation,
    input: SendMessageInput,
  ): Promise<{ msgId: string; messageId: string; done: Promise<void> }> {
    if (input.override?.agent && input.override.agent !== cur.agent) {
      throw new Error('Cannot change conversation agent via per-turn override')
    }
    if (cur.profileId) {
      if (!hasCredentials(cur.profileId, cur.agent, this.deps.agentHomeRoot)) {
        throw new NoCredentialsError(cur.profileId, cur.agent)
      }
    }
    if (this.deps.tm.isBusy(cur.id)) {
      throw new Error(`Conversation ${cur.id} already has a running agent task`)
    }
    const resolved = this.resolveOrThrow(cur.profileId ?? null, { ...cur.extra.overrides, ...input.override }, cur.agent)
    const now = nowMs()
    const msgId = newId()
    const userRowId = newId()
    this.deps.messages.insert({
      id: userRowId, conversationId: cur.id, msgId, role: 'user',
      content: input.content, createdAt: now,
    })
    this.deps.conversations.updateStatus(cur.id, 'running')

    const skillDefs = cur.extra.skills
      .map(name => this.deps.skills.byName(name))
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
    const profileInstructions = composeAppendSystemPrompt(resolved.appendSystemPrompt, skillDefs)

    let prevSession = this.deps.sessions.findByConversation(cur.id)?.agentSessionId
    let envWithHome: Record<string, string> | undefined = resolved.env
    if (cur.profileId) {
      const { path, isNew } = ensureAgentHome(this.deps.agentHomeRoot, cur.profileId, cur.agent)
      envWithHome = { ...envFor(cur.agent, path), ...(resolved.env ?? {}) }
      if (isNew) prevSession = undefined
      writeProfileInstructions(path, profileInstructions)
    }
    // Materialise active skills into the conversation workspace (the agent's
    // cwd) so the relative `.agents/skills/<name>/SKILL.md` pointer resolves for every
    // agent — Claude and Codex alike — regardless of which config dir each one
    // auto-scans.
    writeProfileSkills(cur.workspacePath, skillDefs)
    const { appendSystemPrompt: _, ...resolvedWithoutAppend } = resolved
    const resolvedForTurn: ResolvedProfile = { ...resolvedWithoutAppend, env: envWithHome }
    const task = await this.deps.tm.getOrBuild(
      { id: cur.id, agent: cur.agent, workspacePath: cur.workspacePath },
      resolvedForTurn,
      { prompt: input.content, msgId, prevAgentSessionId: prevSession },
    )

    const messageRowId = newId()
    const relay = new StreamRelay({
      conversationId: cur.id, msgId, messageRowId,
      conversations: this.deps.conversations,
      messages: this.deps.messages,
      artifacts: this.deps.artifacts,
      sessions: this.deps.sessions,
      sse: this.deps.sse,
      cronHandler: async (cmd, convId) => this.deps.cron.handle(cmd, convId),
      agent: cur.agent,
    })
    const done = relay.attach(task.emitter).then(() => {
      if (cur.profileId) this.deps.profiles.touchLastUsed(cur.profileId)
    })

    return { msgId, messageId: userRowId, done }
  }

  async sendMessage(id: string, input: SendMessageInput): Promise<{ msgId: string; messageId: string }> {
    const cur = this.deps.conversations.findById(id)
    if (!cur) throw new Error(`Conversation not found: ${id}`)
    const { msgId, messageId, done } = await this.startTurn(cur, input)
    void done
    return { msgId, messageId }
  }

  async createAndAwaitFirstTurn(
    input: CreateAndAwaitFirstTurnInput,
  ): Promise<CreateAndAwaitFirstTurnResult> {
    const conv = this.create({
      title: input.title,
      profileId: input.profileId,
      projectId: input.projectId,
      override: input.override,
      workspacePath: input.workspacePath,
      source: input.source,
      workflow: input.workflow,
    })
    let done: Promise<void>
    try {
      ;({ done } = await this.startTurn(conv, { content: input.content }))
    } catch (e) {
      // startTurn throws before updating status from 'pending' (e.g.
      // NoCredentialsError, agent mismatch). Without this catch, the
      // conversation row sits at 'pending' forever and the user has no
      // visible feedback. Mark it as 'error' so the chat UI surfaces it,
      // then re-throw so the workflow node fails with the actual reason.
      try { this.deps.conversations.updateStatus(conv.id, 'error') } catch { /* best-effort */ }
      throw e
    }

    if (input.signal?.aborted) {
      await this.cancel(conv.id)
      throw new Error('cancelled before first turn started')
    }
    const abortPromise = input.signal
      ? new Promise<'aborted'>((resolve) => {
          const onAbort = () => resolve('aborted')
          input.signal!.addEventListener('abort', onAbort, { once: true })
        })
      : null

    const result = abortPromise
      ? await Promise.race([done.then(() => 'done' as const), abortPromise])
      : await done.then(() => 'done' as const)

    if (result === 'aborted') {
      await this.cancel(conv.id)
      throw new Error('cancelled during first turn')
    }

    const final = this.deps.conversations.findById(conv.id)
    if (!final) throw new Error(`Conversation vanished: ${conv.id}`)
    if (final.status === 'error') {
      const messages = this.deps.messages.listForConversation(conv.id)
      const last = messages.filter((m) => m.role === 'assistant').pop()
      const errMsg = (last?.metadata as { error?: { message?: string } } | undefined)?.error?.message
        ?? 'agent run failed'
      throw new Error(errMsg)
    }
    const messages = this.deps.messages.listForConversation(conv.id)
    const last = messages.filter((m) => m.role === 'assistant').pop()
    if (!last) throw new Error('first turn finished without an assistant message')
    return { conversationId: conv.id, messageId: last.id, text: last.content }
  }

  async cancel(id: string): Promise<void> {
    await this.deps.tm.kill(id, 'user')
    // Guarantee a terminal state. If a stream relay was attached it has
    // already settled the conversation to 'finished' via the runner's
    // cancelled `done`. If not — the run was killed mid-build, or the agent
    // hung and emitted nothing — drive it terminal ourselves and push a
    // synthetic `done` so the UI clears its streaming state. A user-initiated
    // stop is a clean end, so 'finished' (not 'error', which the UI paints red).
    const cur = this.deps.conversations.findById(id)
    if (cur && (cur.status === 'pending' || cur.status === 'running')) {
      this.deps.conversations.updateStatus(id, 'finished')
      this.deps.sse.publish(id, { name: 'done', data: { finishReason: 'cancelled' } })
    }
  }

  /**
   * Returns the on-disk path to a profile's isolated agent home,
   * regardless of whether it has been created yet.
   */
  agentHomePath(profileId: string, agent: AgentKind): string {
    return homePathFor(this.deps.agentHomeRoot, profileId, agent)
  }

  /**
   * Deletes a profile's agent home directory. The next turn that
   * uses this profile will create a fresh one — auth tokens, MCP
   * config, and session history all reset.
   */
  resetProfileHome(profileId: string, agent: AgentKind): { existed: boolean } {
    return resetProfileHome(this.deps.agentHomeRoot, profileId, agent)
  }

  private resolveOrThrow(
    profileId: string | null,
    override: ProfileOverride | undefined,
    agentHint: AgentKind | undefined,
  ): ResolvedProfile {
    const finalOverride: ProfileOverride = { ...(override ?? {}) }
    if (agentHint && !profileId && !finalOverride.agent) finalOverride.agent = agentHint
    return this.deps.profiles.resolve(profileId, finalOverride)
  }
}
