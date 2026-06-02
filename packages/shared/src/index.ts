/* ============================================================
   API contract types shared between @anubis/backend and the
   @anubis/frontend. Keep these pure data — no Node or React
   types — so the frontend's DOM-only tsconfig can consume them.
   ============================================================ */

export interface ApiHealthResponse {
  ok: true
  service: 'anubis-backend'
  time: string
}

export type AgentKind = 'claude' | 'codex'
export type ProfileSource = 'builtin' | 'user'
export type ConversationStatus = 'pending' | 'running' | 'finished' | 'error'
export type MessageRole = 'user' | 'assistant' | 'system'
export type SkillSource = 'builtin-auto' | 'builtin-opt-in' | 'user'

export interface ProfileSummary {
  id: string
  name: string
  description?: string
  source: ProfileSource
  config: {
    agent: AgentKind
    model?: string
    [key: string]: unknown
  }
  sortOrder: number
  lastUsedAt?: number
  createdAt: number
  updatedAt: number
}

export interface ConversationExtra {
  skills: string[]
  overrides?: Record<string, unknown>
  archived?: boolean
}

export interface ConversationSummary {
  id: string
  title: string
  agent: AgentKind
  status: ConversationStatus
  profileId?: string
  workspacePath: string
  extra: ConversationExtra
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

export interface MessageSummary {
  id: string
  conversationId: string
  msgId: string
  role: MessageRole
  content: string
  metadata?: Record<string, unknown>
  createdAt: number
}

export interface SkillSummary {
  name: string
  description: string
  whenToUse?: string
  source: SkillSource
}

export interface CronJobSummary {
  id: string
  conversationId: string
  name: string
  schedule: string
  scheduleDescription?: string
  prompt: string
  enabled: boolean
  lastRunAt?: number
  createdAt: number
  updatedAt: number
}

export interface CreateConversationInput {
  title: string
  profileId?: string
  workspacePath: string
  agent?: AgentKind
  override?: Record<string, unknown>
}

/* Common response envelopes */

export interface ListResponse<T> {
  ok: true
  items: T[]
}

export type ProfileListResponse = ListResponse<ProfileSummary>
export type ConversationListResponse = ListResponse<ConversationSummary>
export type SkillListResponse = ListResponse<SkillSummary>
export type CronJobListResponse = ListResponse<CronJobSummary>
export type MessageListResponse = ListResponse<MessageSummary>

export interface ConversationCreateResponse {
  ok: true
  conversation: ConversationSummary
}

export interface ApiErrorResponse {
  ok: false
  error:
    | string
    | { code: string; message: string; issues?: unknown[] }
}
