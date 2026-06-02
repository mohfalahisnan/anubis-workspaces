import type { AiAgentService } from '@anubis/ai-agent'
import type { Db } from '../db/client.js'
import { newId } from '../util/ids.js'
import { nowMs } from '../util/time.js'
import { computeInitialSkills } from '../skills/snapshot.js'
import { composeAppendSystemPrompt } from '../skills/inject.js'
import type { SkillLoader } from '../skills/loader.js'
import type { ProfileService } from '../profiles/profile-service.js'
import type { ProfileOverride, ResolvedProfile } from '../profiles/types.js'
import {
  ensureAgentHome,
  envFor,
  homePathFor,
  resetProfileHome,
} from '../profiles/agent-home.js'
import type { ConversationsRepo } from '../db/repositories/conversations-repo.js'
import type { MessagesRepo } from '../db/repositories/messages-repo.js'
import type { ArtifactsRepo } from '../db/repositories/artifacts-repo.js'
import type { AgentSessionsRepo } from '../db/repositories/agent-sessions-repo.js'
import type { SseBroadcaster } from '../sse/broadcaster.js'
import type { CronService } from '../cron/cron-service.js'
import type { TaskManager } from './task-manager.js'
import type { Conversation, ConversationExtra, Message } from './types.js'
import { StreamRelay } from './stream-relay.js'

export interface CreateConversationInput {
  title: string
  profileId?: string
  override?: ProfileOverride
  workspacePath: string
  agent?: 'claude' | 'codex'
}

export interface SendMessageInput {
  content: string
  override?: ProfileOverride
}

export interface UpdateConversationInput {
  title?: string
  override?: ProfileOverride
  archived?: boolean
  profileId?: string | null
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
  /**
   * Root directory under which each profile gets its own isolated
   * agent home folder ({agentHomeRoot}/{profileId}/{agent}/).
   * Composition root sets this to {ANUBIS_DATA_DIR}/agent-homes.
   */
  agentHomeRoot: string
}

export class ConversationService {
  constructor(private deps: ConversationServiceDeps) {}

  create(input: CreateConversationInput): Conversation {
    const resolved = this.resolveOrThrow(input.profileId ?? null, input.override, input.agent)
    const skills = computeInitialSkills(this.deps.skills.discoverAll(), resolved)
    const now = nowMs()
    const conv: Conversation = {
      id: newId(),
      title: input.title,
      agent: resolved.agent,
      status: 'pending',
      profileId: input.profileId,
      workspacePath: input.workspacePath,
      extra: { skills, overrides: input.override },
      createdAt: now,
      updatedAt: now,
    }
    this.deps.conversations.insert(conv)
    if (input.profileId) this.deps.profiles.touchLastUsed(input.profileId)
    return conv
  }

  list(opts: { limit?: number; archived?: boolean } = {}): Conversation[] {
    return this.deps.conversations.list({ limit: opts.limit ?? 50, archived: opts.archived })
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
    this.deps.conversations.updateFields(id, {
      title: patch.title,
      extra,
      profileId: patch.profileId === undefined ? undefined : patch.profileId,
    })
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

  async sendMessage(id: string, input: SendMessageInput): Promise<{ msgId: string; messageId: string }> {
    const cur = this.deps.conversations.findById(id)
    if (!cur) throw new Error(`Conversation not found: ${id}`)
    if (input.override?.agent && input.override.agent !== cur.agent) {
      throw new Error('Cannot change conversation agent via per-turn override')
    }
    if (this.deps.tm.isBusy(id)) {
      throw new Error(`Conversation ${id} already has a running agent task`)
    }
    const resolved = this.resolveOrThrow(cur.profileId ?? null, { ...cur.extra.overrides, ...input.override }, cur.agent)
    const now = nowMs()
    const msgId = newId()
    const userRowId = newId()
    this.deps.messages.insert({
      id: userRowId, conversationId: id, msgId, role: 'user',
      content: input.content, createdAt: now,
    })
    this.deps.conversations.updateStatus(id, 'running')

    const skillDefs = cur.extra.skills
      .map(name => this.deps.skills.byName(name))
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
    const appendSystemPrompt = composeAppendSystemPrompt(resolved.appendSystemPrompt, skillDefs)

    // Auto-isolate this profile's agent home. profile.env always wins
    // so power users can override (e.g. point two profiles at the same
    // identity) if they really want to.
    let prevSession = this.deps.sessions.findByConversation(id)?.agentSessionId
    let envWithHome: Record<string, string> | undefined = resolved.env
    if (cur.profileId) {
      const { path, isNew } = ensureAgentHome(
        this.deps.agentHomeRoot,
        cur.profileId,
        cur.agent,
      )
      envWithHome = { ...envFor(cur.agent, path), ...(resolved.env ?? {}) }
      // First turn after the home dir was provisioned: the agent has no
      // record of the prior resume id (it lived in the OLD shared home),
      // so we start fresh inside the new isolated home.
      if (isNew) prevSession = undefined
    }
    const resolvedForTurn: ResolvedProfile = { ...resolved, env: envWithHome, appendSystemPrompt }
    const task = await this.deps.tm.getOrBuild(
      { id, agent: cur.agent, workspacePath: cur.workspacePath },
      resolvedForTurn,
      { prompt: input.content, msgId, appendSystemPrompt, prevAgentSessionId: prevSession },
    )

    const messageRowId = newId()
    const relay = new StreamRelay({
      conversationId: id, msgId, messageRowId,
      conversations: this.deps.conversations,
      messages: this.deps.messages,
      artifacts: this.deps.artifacts,
      sessions: this.deps.sessions,
      sse: this.deps.sse,
      cronHandler: async (cmd, convId) => this.deps.cron.handle(cmd, convId),
      agent: cur.agent,
    })
    void relay.attach(task.emitter).then(() => {
      if (cur.profileId) this.deps.profiles.touchLastUsed(cur.profileId)
    })

    return { msgId, messageId: userRowId }
  }

  async cancel(id: string): Promise<void> {
    await this.deps.tm.kill(id, 'user')
    this.deps.conversations.updateStatus(id, 'error')
  }

  /**
   * Returns the on-disk path to a profile's isolated agent home,
   * regardless of whether it has been created yet.
   */
  agentHomePath(profileId: string, agent: 'claude' | 'codex'): string {
    return homePathFor(this.deps.agentHomeRoot, profileId, agent)
  }

  /**
   * Deletes a profile's agent home directory. The next turn that
   * uses this profile will create a fresh one — auth tokens, MCP
   * config, and session history all reset.
   */
  resetProfileHome(profileId: string, agent: 'claude' | 'codex'): { existed: boolean } {
    return resetProfileHome(this.deps.agentHomeRoot, profileId, agent)
  }

  private resolveOrThrow(
    profileId: string | null,
    override: ProfileOverride | undefined,
    agentHint: 'claude' | 'codex' | undefined,
  ): ResolvedProfile {
    const finalOverride: ProfileOverride = { ...(override ?? {}) }
    if (agentHint && !profileId && !finalOverride.agent) finalOverride.agent = agentHint
    return this.deps.profiles.resolve(profileId, finalOverride)
  }
}
