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

export interface ProfileHomeInfo {
  /** Absolute path to the profile's isolated agent home directory. */
  path: string
  /** True if the directory has been created (i.e. the profile has been used at least once). */
  exists: boolean
}

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
  /** Per-profile isolated agent home; populated by the backend route layer. */
  home?: ProfileHomeInfo
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

export interface SkillDetail extends SkillSummary {
  /** Absolute path to the SKILL.md file on disk. */
  path: string
  /** Markdown body of the skill, with the frontmatter stripped. */
  body: string
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

export interface UpdateCronJobInput {
  name?: string
  schedule?: string
  scheduleDescription?: string
  prompt?: string
  enabled?: boolean
}

export interface CompetitorSummary {
  id: string
  handle: string
  displayName?: string
  niche?: string
  tint?: string
  followers?: number
  avgLikes?: number
  postCount: number
  lastRefreshedAt?: number
  notes?: string
  addedAt: number
  updatedAt: number
}

export interface CreateCompetitorInput {
  handle: string
  displayName?: string
  niche?: string
  tint?: string
  followers?: number
  avgLikes?: number
  notes?: string
}

export interface UpdateCompetitorInput {
  displayName?: string
  niche?: string
  tint?: string
  followers?: number
  avgLikes?: number
  postCount?: number
  notes?: string
}

/* Discovery — surfaces adjacent IG profiles to add as competitors. */
export type DiscoverySource = 'explore' | 'hashtag' | 'keyword'

export interface DiscoverCompetitorsInput {
  source: DiscoverySource
  hashtag?: string
  keyword?: string
  targetCompetitors?: number
  timeoutMs?: number
  profile?: 'login' | 'public' | 'flow'
}

export interface DiscoveredCandidate {
  username: string
  fullName?: string
  bio?: string
  followers?: number
  profileImageUrl?: string
  profileUrl?: string
}

export interface CreateConversationInput {
  title: string
  profileId?: string
  workspacePath: string
  agent?: AgentKind
  override?: Record<string, unknown>
}

export interface ProfileConfigInput {
  agent: AgentKind
  model?: string
  [key: string]: unknown
}

export interface CreateProfileInput {
  name: string
  description?: string
  config: ProfileConfigInput
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
export type CompetitorListResponse = ListResponse<CompetitorSummary>

export interface CapturedPostSummary {
  id: string
  competitorId: string
  username: string
  postUrl: string
  caption?: string
  likes?: number
  comments?: number
  /** ISO timestamp from the source platform. */
  postedAt?: string
  mediaKind?: 'image' | 'video' | 'carousel'
  mediaUrl?: string
  carouselCount?: number
  capturedAt: number
  /** Owning competitor's handle, joined in by the route layer. */
  competitorHandle?: string
  /** Owning competitor's accent tint, joined in by the route layer. */
  competitorTint?: string
}

export type CapturedPostListResponse = ListResponse<CapturedPostSummary>

export interface CaptureResultPayload {
  ok: true
  competitor: CompetitorSummary
  capturedCount: number
  warnings: string[]
}

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
