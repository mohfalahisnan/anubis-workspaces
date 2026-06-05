import {
  AGENT_NOT_INSTALLED_ERROR_CODE,
  NO_CREDENTIALS_ERROR_CODE,
  type AgentAvailability,
  type AgentNotInstalledErrorPayload,
  type ApiHealthResponse,
  type AppConfig,
  type CapturedPostListResponse,
  type CapturedPostSummary,
  type CaptureResultPayload,
  type CompetitorListResponse,
  type CompetitorSummary,
  type ConversationCreateResponse,
  type ConversationListResponse,
  type ConversationSummary,
  type CreateCompetitorInput,
  type CreateConversationInput,
  type CreateProfileInput,
  type CronJobListResponse,
  type CronJobSummary,
  type DiscoverCompetitorsInput,
  type DiscoveredCandidate,
  type MessageListResponse,
  type MessageSummary,
  type NoCredentialsErrorPayload,
  type ProfileListResponse,
  type ProfileSummary,
  type SkillDetail,
  type SkillListResponse,
  type SkillSource,
  type SkillSummary,
  type UpdateCompetitorInput,
  type UpdateCapturedPostInput,
  type UpdateCronJobInput,
  type WorkspaceSummary,
} from '@anubis/shared'

/* ------------------------------------------------------------
   Errors
   ------------------------------------------------------------ */

export class NoCredentialsError extends Error {
  readonly code = NO_CREDENTIALS_ERROR_CODE
  constructor(public readonly profileId: string, public readonly agent: 'claude' | 'codex') {
    super(`no credentials for profile ${profileId} (${agent})`)
    this.name = 'NoCredentialsError'
  }
}

export class AgentNotInstalledError extends Error {
  readonly code = AGENT_NOT_INSTALLED_ERROR_CODE
  constructor(public readonly agent: 'claude' | 'codex', message?: string) {
    super(message ?? `${agent} CLI is not installed (not on PATH).`)
    this.name = 'AgentNotInstalledError'
  }
}

/* ------------------------------------------------------------
   Base URL resolution
   ------------------------------------------------------------ */

export async function getApiBaseUrl(): Promise<string> {
  if (typeof window !== 'undefined' && window.anubis) {
    return window.anubis.backend.getBaseUrl()
  }

  return import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:4317'
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = await getApiBaseUrl()
  const response = await fetch(new URL(path, baseUrl), {
    ...init,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...init?.headers,
    },
  })

  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const body = await response.clone().json() as { error?: unknown }
      if (response.status === 409 && body.error && typeof body.error === 'object') {
        const err = body.error as Partial<NoCredentialsErrorPayload> | Partial<AgentNotInstalledErrorPayload>
        if (err.code === NO_CREDENTIALS_ERROR_CODE) {
          const e = err as Partial<NoCredentialsErrorPayload>
          if (e.profileId && e.agent) throw new NoCredentialsError(e.profileId, e.agent)
        }
        if (err.code === AGENT_NOT_INSTALLED_ERROR_CODE) {
          const e = err as Partial<AgentNotInstalledErrorPayload>
          if (e.agent) throw new AgentNotInstalledError(e.agent, e.message)
        }
      }
      if (body.error) {
        if (typeof body.error === 'string') {
          detail = body.error
        } else if (typeof body.error === 'object') {
          // Hono-style { error: { code, message } } → prefer the message
          // so the user sees a readable string, not raw JSON.
          const e = body.error as { code?: string; message?: string }
          detail = e.message ?? JSON.stringify(body.error)
        }
      }
    } catch (e) {
      if (e instanceof NoCredentialsError) throw e
      if (e instanceof AgentNotInstalledError) throw e
      // swallow — keep the generic detail
    }
    throw new Error(`${path} failed: ${detail}`)
  }

  return response.json() as Promise<T>
}

/* ------------------------------------------------------------
   Endpoints
   ------------------------------------------------------------ */

export function getHealth(): Promise<ApiHealthResponse> {
  return api<ApiHealthResponse>('/health')
}

/* ---------- App config ---------- */

export async function getAppConfig(): Promise<AppConfig> {
  const r = await api<{ ok: true; config: AppConfig }>('/config')
  return r.config
}

export async function updateAppConfig(patch: AppConfig): Promise<AppConfig> {
  const r = await api<{ ok: true; config: AppConfig }>('/config', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  return r.config
}

/* ---------- Profiles ---------- */

export async function listProfiles(): Promise<ProfileSummary[]> {
  const r = await api<ProfileListResponse>('/profiles')
  return r.items
}

export async function getProfile(id: string): Promise<ProfileSummary> {
  const r = await api<{ ok: true; profile: ProfileSummary }>(
    `/profiles/${encodeURIComponent(id)}`,
  )
  return r.profile
}

export async function createProfile(input: CreateProfileInput): Promise<ProfileSummary> {
  const r = await api<{ ok: true; profile: ProfileSummary }>('/profiles', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return r.profile
}

export interface CopyProfileInput {
  name: string
  description?: string
}

export async function copyProfile(
  id: string,
  input: CopyProfileInput,
): Promise<ProfileSummary> {
  const r = await api<{ ok: true; profile: ProfileSummary }>(
    `/profiles/${encodeURIComponent(id)}/copy`,
    { method: 'POST', body: JSON.stringify(input) },
  )
  return r.profile
}

export async function deleteProfile(id: string): Promise<void> {
  await api<{ ok: true }>(`/profiles/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function resetProfileHome(
  id: string,
): Promise<{ existed: boolean }> {
  const r = await api<{ ok: true; existed: boolean }>(
    `/profiles/${encodeURIComponent(id)}/reset-home`,
    { method: 'POST' },
  )
  return { existed: r.existed }
}

export async function openLoginTerminal(
  id: string,
): Promise<void> {
  await api<{ ok: true }>(
    `/profiles/${encodeURIComponent(id)}/login/terminal`,
    { method: 'POST' },
  )
}

export interface UpdateProfileInput {
  name?: string
  description?: string
  configPatch?: Record<string, unknown>
  sortOrder?: number
}

export async function updateProfile(
  id: string,
  patch: UpdateProfileInput,
): Promise<ProfileSummary> {
  const r = await api<{ ok: true; profile: ProfileSummary }>(
    `/profiles/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  )
  return r.profile
}

/* ai-agent catalog — drives the model + reasoning dropdowns */

export interface ModelInfo {
  id: string
  category: 'recommended' | 'recommended_research_preview' | 'alternative'
  description: string
}

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high'

export interface AgentCatalog {
  agents: readonly ('claude' | 'codex')[]
  models: Record<'claude' | 'codex', ModelInfo[]>
  defaultModel: Record<'claude' | 'codex', string>
  reasoningEfforts: readonly ReasoningEffort[]
  defaultReasoningEffort: ReasoningEffort
  agentAvailability: Record<'claude' | 'codex', AgentAvailability>
}

export async function getCatalog(): Promise<AgentCatalog> {
  const r = await api<{ ok: true; catalog: AgentCatalog }>('/ai-agent/catalog')
  return r.catalog
}

export async function listConversations(
  opts: { limit?: number; archived?: boolean } = {},
): Promise<ConversationSummary[]> {
  const params = new URLSearchParams()
  if (opts.limit !== undefined) params.set('limit', String(opts.limit))
  if (opts.archived !== undefined) params.set('archived', String(opts.archived))
  const qs = params.toString()
  const path = qs ? `/conversations?${qs}` : '/conversations'
  const r = await api<ConversationListResponse>(path)
  return r.items
}

export async function getConversation(id: string): Promise<ConversationSummary> {
  const r = await api<{ ok: true; conversation: ConversationSummary }>(
    `/conversations/${encodeURIComponent(id)}`,
  )
  return r.conversation
}

export async function createConversation(
  input: CreateConversationInput,
): Promise<ConversationSummary> {
  const r = await api<ConversationCreateResponse>('/conversations', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return r.conversation
}

export interface UpdateConversationInput {
  title?: string
  archived?: boolean
  override?: Record<string, unknown>
  profileId?: string | null
  workspacePath?: string
}

export async function updateConversation(
  id: string,
  patch: UpdateConversationInput,
): Promise<ConversationSummary> {
  const r = await api<{ ok: true; conversation: ConversationSummary }>(
    `/conversations/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  )
  return r.conversation
}

export async function listMessages(conversationId: string): Promise<MessageSummary[]> {
  const r = await api<MessageListResponse>(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
  )
  return r.items
}

export async function sendMessage(
  conversationId: string,
  content: string,
): Promise<{ msgId: string; messageId: string }> {
  const r = await api<{ ok: true; msgId: string; messageId: string }>(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    { method: 'POST', body: JSON.stringify({ content }) },
  )
  return { msgId: r.msgId, messageId: r.messageId }
}

export async function cancelConversation(conversationId: string): Promise<void> {
  await api<{ ok: true }>(
    `/conversations/${encodeURIComponent(conversationId)}/cancel`,
    { method: 'POST' },
  )
}

export async function listWorkspaces(): Promise<WorkspaceSummary[]> {
  const r = await api<{ ok: true; items: WorkspaceSummary[] }>('/workspaces')
  return r.items
}

export async function removeWorkspace(path: string): Promise<void> {
  await api<{ ok: true }>('/workspaces', {
    method: 'DELETE',
    body: JSON.stringify({ path }),
  })
}

export async function deleteConversation(conversationId: string): Promise<void> {
  await api<{ ok: true }>(
    `/conversations/${encodeURIComponent(conversationId)}`,
    { method: 'DELETE' },
  )
}

export async function listSkills(): Promise<SkillSummary[]> {
  const r = await api<SkillListResponse>('/skills')
  return r.items
}

export async function getSkill(name: string): Promise<SkillDetail> {
  const r = await api<{ ok: true; skill: SkillDetail }>(
    `/skills/${encodeURIComponent(name)}`,
  )
  return r.skill
}

export async function reloadSkills(): Promise<{ count: number }> {
  const r = await api<{ ok: true; count: number }>('/skills/reload', {
    method: 'POST',
  })
  return { count: r.count }
}

export type SkillImportCategory = 'auto' | 'opt-in' | 'user'

export interface ImportSkillInput {
  sourcePath: string
  kind: 'folder' | 'zip'
  category: SkillImportCategory
}

export async function importSkill(
  input: ImportSkillInput,
): Promise<{ name: string; source: SkillSource; count: number }> {
  const r = await api<{ ok: true; name: string; source: SkillSource; count: number }>(
    '/skills/import',
    { method: 'POST', body: JSON.stringify(input) },
  )
  return { name: r.name, source: r.source, count: r.count }
}

export async function listCronJobs(conversationId?: string): Promise<CronJobSummary[]> {
  const path = conversationId
    ? `/cron-jobs?conversationId=${encodeURIComponent(conversationId)}`
    : '/cron-jobs'
  const r = await api<CronJobListResponse>(path)
  return r.items
}

export async function updateCronJob(
  id: string,
  patch: UpdateCronJobInput,
): Promise<CronJobSummary> {
  const r = await api<{ ok: true; job: CronJobSummary }>(
    `/cron-jobs/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  )
  return r.job
}

export async function deleteCronJob(id: string): Promise<void> {
  await api<{ ok: true }>(`/cron-jobs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function listCompetitors(): Promise<CompetitorSummary[]> {
  const r = await api<CompetitorListResponse>('/competitors')
  return r.items
}

export async function createCompetitor(
  input: CreateCompetitorInput,
): Promise<CompetitorSummary> {
  const r = await api<{ ok: true; competitor: CompetitorSummary }>('/competitors', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return r.competitor
}

export async function updateCompetitor(
  id: string,
  patch: UpdateCompetitorInput,
): Promise<CompetitorSummary> {
  const r = await api<{ ok: true; competitor: CompetitorSummary }>(
    `/competitors/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  )
  return r.competitor
}

export async function deleteCompetitor(id: string): Promise<void> {
  await api<{ ok: true }>(`/competitors/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export interface CaptureOptions {
  profile?: 'login' | 'public' | 'flow'
  headless?: boolean
  /** Required when running the 'login' profile headless. */
  forceHeadless?: boolean
  maxResponses?: number
  timeoutMs?: number
}

export interface OpenCrawlerChromeResult {
  ok: true
  pid: number | null
  reused: boolean
  remoteDebuggingPort: number
  profile: 'login' | 'public' | 'flow'
  profileDir: string
  url: string
  headless: boolean
  warnings: string[]
}

export async function openInstagramLoginChrome(): Promise<OpenCrawlerChromeResult> {
  return api<OpenCrawlerChromeResult>('/research-crawler/chrome/open', {
    method: 'POST',
    body: JSON.stringify({
      profile: 'login',
      headless: false,
      url: 'https://www.instagram.com/',
    }),
  })
}

export async function captureCompetitor(
  id: string,
  options: CaptureOptions = {},
): Promise<{ competitor: CompetitorSummary; capturedCount: number; warnings: string[] }> {
  const r = await api<CaptureResultPayload>(
    `/captures/competitors/${encodeURIComponent(id)}`,
    { method: 'POST', body: JSON.stringify(options) },
  )
  return {
    competitor: r.competitor,
    capturedCount: r.capturedCount,
    warnings: r.warnings,
  }
}

export interface ListPostsOpts {
  competitorId?: string
  limit?: number
  orderBy?: 'recent' | 'engagement'
}

/**
 * Runs the research-crawler's discovery flow (explore / hashtag /
 * keyword) and returns the candidate profiles it surfaces. The raw
 * route returns a StandardCrawlerOutput; we strip that down to the
 * `output.profiles[]` since that's what the UI shows.
 */
export async function discoverCompetitors(
  input: DiscoverCompetitorsInput,
): Promise<DiscoveredCandidate[]> {
  interface CrawlerProfile {
    username: string
    fullName?: string
    bio?: string
    followers?: number
    profileImageUrl?: string
    profileUrl?: string
  }
  interface CrawlerResponse {
    ok: boolean
    output: { profiles: CrawlerProfile[] }
    error?: { code: string; message: string }
    meta: { warnings: string[] }
  }
  const r = await api<CrawlerResponse>('/research-crawler/instagram/discover', {
    method: 'POST',
    body: JSON.stringify({
      source: input.source,
      hashtag: input.source === 'hashtag' ? input.hashtag : undefined,
      keyword: input.source === 'keyword' ? input.keyword : undefined,
      targetCompetitors: input.targetCompetitors,
      timeoutMs: input.timeoutMs,
      profile: input.profile,
      headless: input.headless,
      forceHeadless: input.forceHeadless,
    }),
  })
  if (!r.ok) {
    throw new Error(r.error?.message ?? 'Discovery failed.')
  }
  return r.output.profiles.map((p) => ({
    username: p.username,
    fullName: p.fullName,
    bio: p.bio,
    followers: p.followers,
    profileImageUrl: p.profileImageUrl,
    profileUrl: p.profileUrl,
  }))
}

export async function listPosts(
  opts: ListPostsOpts = {},
): Promise<CapturedPostSummary[]> {
  const params = new URLSearchParams()
  if (opts.competitorId) params.set('competitorId', opts.competitorId)
  if (opts.limit !== undefined) params.set('limit', String(opts.limit))
  if (opts.orderBy) params.set('orderBy', opts.orderBy)
  const qs = params.toString()
  const path = qs ? `/posts?${qs}` : '/posts'
  const r = await api<CapturedPostListResponse>(path)
  return r.items
}

export async function updatePost(
  id: string,
  patch: UpdateCapturedPostInput,
): Promise<CapturedPostSummary> {
  const r = await api<{ ok: true; post: CapturedPostSummary }>(
    `/posts/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  )
  return r.post
}

export async function deletePost(id: string): Promise<void> {
  await api<{ ok: true }>(`/posts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}
