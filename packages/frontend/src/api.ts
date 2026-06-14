import {
  AGENT_NOT_INSTALLED_ERROR_CODE,
  NO_CREDENTIALS_ERROR_CODE,
  type AgentAvailability,
  type AgentKind,
  type AgentNotInstalledErrorPayload,
  type ApiHealthResponse,
  type AppConfig,
  type CapturedPostListResponse,
  type CapturedPostSummary,
  type ContentItemListResponse,
  type ContentItemStatus,
  type ContentItemSummary,
  type AiReview,
  type BrandContext,
  type ContentLesson,
  type ContentPipeline,
  type HumanReview,
  type ImprovedBrief,
  type RefinedContent,
  type CapturePreviewPayload,
  type CaptureResultPayload,
  type CompetitorListResponse,
  type CompetitorSummary,
  type CreateContentItemInput,
  type CreateTaskInput,
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
  type TaskListResponse,
  type TaskPriority,
  type TaskStatus,
  type TaskSummary,
  type UpdateCompetitorInput,
  type UpdateCapturedPostInput,
  type UpdateContentItemInput,
  type UpdateCronJobInput,
  type UpdateTaskInput,
  type WorkspaceSummary,
  type ImportCapturedPostsInput,
  type ProjectSummary,
  type CreateProjectInput,
  type UpdateProjectInput,
  type ProjectListResponse,
  type KnowledgeBaseDocument,
  type KnowledgeBaseGraph,
  type KnowledgeBaseSearchHit,
  type KnowledgeBaseStats,
  type OcrResult,
  type TranscribeResult,
  type WhisperModel,
  type JobSummary,
  type JobListResponse,
  type ProjectSnapshot,
  type ImportSnapshotInput,
  type ImportSnapshotResult,
  type CreateResearchSessionInput,
  type ResearchControls,
  type ResearchSessionSummary,
  type ResearchSessionListResponse,
  type ResearchCandidateSummary,
  type ResearchCandidateListResponse,
  type UpdateResearchCandidateInput,
  type CandidateDecision,
  type CandidateLevel,
  type CandidateValidationStatus,
} from '@anubis/shared'

/* ------------------------------------------------------------
   Errors
   ------------------------------------------------------------ */

export class NoCredentialsError extends Error {
  readonly code = NO_CREDENTIALS_ERROR_CODE
  constructor(public readonly profileId: string, public readonly agent: AgentKind) {
    super(`no credentials for profile ${profileId} (${agent})`)
    this.name = 'NoCredentialsError'
  }
}

export class AgentNotInstalledError extends Error {
  readonly code = AGENT_NOT_INSTALLED_ERROR_CODE
  constructor(public readonly agent: AgentKind, message?: string) {
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
  agents: readonly AgentKind[]
  models: Record<AgentKind, ModelInfo[]>
  defaultModel: Record<AgentKind, string>
  reasoningEfforts: readonly ReasoningEffort[]
  defaultReasoningEffort: ReasoningEffort
  agentAvailability: Record<AgentKind, AgentAvailability>
}

export async function getCatalog(): Promise<AgentCatalog> {
  const r = await api<{ ok: true; catalog: AgentCatalog }>('/ai-agent/catalog')
  return r.catalog
}

export async function listConversations(
  opts: { limit?: number; archived?: boolean; source?: 'manual' | 'workflow'; projectId?: string } = {},
): Promise<ConversationSummary[]> {
  const params = new URLSearchParams()
  if (opts.limit !== undefined) params.set('limit', String(opts.limit))
  if (opts.archived !== undefined) params.set('archived', String(opts.archived))
  if (opts.source !== undefined) params.set('source', opts.source)
  if (opts.projectId !== undefined) params.set('projectId', opts.projectId)
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
  fileReferences?: string[],
): Promise<{ msgId: string; messageId: string }> {
  const r = await api<{ ok: true; msgId: string; messageId: string }>(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    { method: 'POST', body: JSON.stringify({ content, fileReferences }) },
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

export async function listCronJobs(conversationId?: string, projectId?: string): Promise<CronJobSummary[]> {
  const params = new URLSearchParams()
  if (conversationId) params.set('conversationId', conversationId)
  if (projectId) params.set('projectId', projectId)
  const qs = params.toString()
  const path = qs ? `/cron-jobs?${qs}` : '/cron-jobs'
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

export interface CreateCronJobInput {
  name: string
  schedule: string
  scheduleDescription?: string
  actionType: 'message' | 'competitor-discovery' | 'capture-posts' | 'workflow'
  actionConfig?: any
  prompt?: string
  projectId?: string
}

export async function createCronJob(
  input: CreateCronJobInput,
): Promise<CronJobSummary> {
  const r = await api<{ ok: true; job: CronJobSummary }>('/cron-jobs', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return r.job
}

export async function listCompetitors(projectId?: string): Promise<CompetitorSummary[]> {
  const path = projectId ? `/competitors?projectId=${encodeURIComponent(projectId)}` : '/competitors'
  const r = await api<CompetitorListResponse>(path)
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

/* ---------- Research Phase ---------- */

export async function createResearchSession(
  input: CreateResearchSessionInput,
): Promise<{ session: ResearchSessionSummary; candidates: ResearchCandidateSummary[] }> {
  const r = await api<{ ok: true; session: ResearchSessionSummary; candidates: ResearchCandidateSummary[] }>(
    '/research/sessions',
    { method: 'POST', body: JSON.stringify(input) },
  )
  return { session: r.session, candidates: r.candidates }
}

export async function listResearchSessions(projectId?: string): Promise<ResearchSessionSummary[]> {
  const path = projectId
    ? `/research/sessions?projectId=${encodeURIComponent(projectId)}`
    : '/research/sessions'
  const r = await api<ResearchSessionListResponse>(path)
  return r.items
}

export async function listSessionCandidates(sessionId: string): Promise<ResearchCandidateSummary[]> {
  const r = await api<ResearchCandidateListResponse>(
    `/research/sessions/${encodeURIComponent(sessionId)}/candidates`,
  )
  return r.items
}

export async function listResearchCandidates(
  opts: { projectId?: string; validation?: CandidateValidationStatus; level?: CandidateLevel; decision?: CandidateDecision } = {},
): Promise<ResearchCandidateSummary[]> {
  const params = new URLSearchParams()
  if (opts.projectId) params.set('projectId', opts.projectId)
  if (opts.validation) params.set('validation', opts.validation)
  if (opts.level) params.set('level', opts.level)
  if (opts.decision) params.set('decision', opts.decision)
  const qs = params.toString()
  const r = await api<ResearchCandidateListResponse>(`/research/candidates${qs ? `?${qs}` : ''}`)
  return r.items
}

export async function updateResearchCandidate(
  id: string,
  patch: UpdateResearchCandidateInput,
): Promise<ResearchCandidateSummary> {
  const r = await api<{ ok: true; candidate: ResearchCandidateSummary }>(
    `/research/candidates/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  )
  return r.candidate
}

// Re-exported so pages can build a controls object without importing from @anubis/shared directly.
export type { ResearchControls }

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
  targetPosts?: number
  preview?: boolean
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

/**
 * Start a post capture as a background job. Returns the job id immediately;
 * monitor progress via {@link streamJobs} or {@link listJobs}.
 */
export async function captureCompetitorAsync(
  id: string,
  options: CaptureOptions = {},
): Promise<{ jobId: string }> {
  const r = await api<{ ok: true; jobId: string }>(
    `/captures/competitors/${encodeURIComponent(id)}`,
    { method: 'POST', body: JSON.stringify({ ...options, async: true }) },
  )
  return { jobId: r.jobId }
}

/**
 * Capture a selection of competitors as a single chunked background job
 * (max 8 profiles per chunk, with a randomized cooldown between chunks).
 * Returns the job id immediately; monitor + stop it via the jobs feed.
 */
export async function captureCompetitorsBatch(
  competitorIds: string[],
  options: Omit<CaptureOptions, 'preview'> = {},
): Promise<{ jobId: string }> {
  const { profile, headless, forceHeadless, maxResponses, targetPosts, timeoutMs } = options
  const r = await api<{ ok: true; jobId: string }>('/captures/competitors/batch', {
    method: 'POST',
    body: JSON.stringify({
      competitorIds,
      profile,
      headless,
      forceHeadless,
      maxResponses,
      targetPosts,
      timeoutMs,
    }),
  })
  return { jobId: r.jobId }
}

/**
 * Captured posts a batch run has surfaced so far (streamed per-profile while
 * the job runs; the finished job's full set afterward). The Capture Posts
 * results panel polls this and lets the user select which to save to Content.
 */
export async function listBatchCandidates(
  jobId: string,
): Promise<{ candidates: CapturedPostSummary[]; running: boolean }> {
  const r = await api<{ ok: true; candidates: CapturedPostSummary[]; running: boolean }>(
    `/captures/competitors/batch/${encodeURIComponent(jobId)}/candidates`,
  )
  return { candidates: r.candidates, running: r.running }
}

export async function captureCompetitorPreview(
  id: string,
  options: CaptureOptions = {},
): Promise<{ competitor: CompetitorSummary; posts: CapturedPostSummary[]; warnings: string[] }> {
  const r = await api<CapturePreviewPayload>(
    `/captures/competitors/${encodeURIComponent(id)}`,
    { method: 'POST', body: JSON.stringify({ ...options, preview: true }) },
  )
  return {
    competitor: r.competitor,
    posts: r.posts,
    warnings: r.warnings,
  }
}

export async function importCapturedPosts(
  input: ImportCapturedPostsInput,
): Promise<{ importedCount: number }> {
  const r = await api<{ ok: true; importedCount: number }>('/posts/import', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return { importedCount: r.importedCount }
}

export interface ListPostsOpts {
  competitorId?: string
  projectId?: string
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

/**
 * Start competitor discovery as a background job. Returns the job id
 * immediately; the job's result (on completion) carries the candidate
 * profiles. Monitor via {@link streamJobs} or {@link listJobs}.
 */
export async function discoverCompetitorsAsync(
  input: DiscoverCompetitorsInput & { projectId?: string },
): Promise<{ jobId: string }> {
  const r = await api<{ ok: true; jobId: string }>('/research-crawler/instagram/discover', {
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
      projectId: input.projectId,
      async: true,
    }),
  })
  return { jobId: r.jobId }
}

/* ---------- Background jobs ---------- */

export async function listJobs(): Promise<JobSummary[]> {
  const r = await api<JobListResponse>('/jobs')
  return r.items
}

export async function getJob(id: string): Promise<JobSummary | null> {
  const baseUrl = await getApiBaseUrl()
  const response = await fetch(new URL(`/jobs/${encodeURIComponent(id)}`, baseUrl))
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`getJob failed: HTTP ${response.status}`)
  const body = (await response.json()) as { ok: true; job: JobSummary }
  return body.job
}

export async function dismissJob(id: string): Promise<void> {
  await api<{ ok: true }>(`/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/**
 * Request a stop for a queued/running job. The job winds down gracefully and
 * settles as `stopped`; already-completed work is preserved.
 */
export async function cancelJob(id: string): Promise<JobSummary | null> {
  const r = await api<{ ok: true; job: JobSummary | null }>(
    `/jobs/${encodeURIComponent(id)}/cancel`,
    { method: 'POST' },
  )
  return r.job ?? null
}

export interface JobStreamHandlers {
  /** Full set of current jobs, sent once on connect. */
  onSnapshot?: (jobs: JobSummary[]) => void
  /** A job was created or changed (progress / finished). */
  onJob?: (job: JobSummary) => void
  /** A job was dismissed or pruned. */
  onRemoved?: (id: string) => void
  signal?: AbortSignal
}

/**
 * Subscribe to the backend job feed via Server-Sent Events. Resolves when
 * the stream closes; pass an AbortSignal to stop listening.
 */
export async function streamJobs(handlers: JobStreamHandlers = {}): Promise<void> {
  const baseUrl = await getApiBaseUrl()
  const response = await fetch(new URL('/jobs/stream', baseUrl), {
    headers: { accept: 'text/event-stream' },
    signal: handlers.signal,
  })
  if (!response.ok || !response.body) {
    throw new Error(`Job stream failed: HTTP ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const handleEvent = (raw: string) => {
    let event = 'message'
    const dataLines: string[] = []
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
    }
    if (dataLines.length === 0) return
    const data = dataLines.join('\n')
    try {
      if (event === 'snapshot') handlers.onSnapshot?.(JSON.parse(data) as JobSummary[])
      else if (event === 'job') handlers.onJob?.(JSON.parse(data) as JobSummary)
      else if (event === 'removed') handlers.onRemoved?.((JSON.parse(data) as { id: string }).id)
      // 'ping' heartbeats are ignored.
    } catch {
      /* ignore malformed frames */
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      if (chunk.trim()) handleEvent(chunk)
    }
  }
  if (buffer.trim()) handleEvent(buffer)
}

export async function listPosts(
  opts: ListPostsOpts = {},
): Promise<CapturedPostSummary[]> {
  const params = new URLSearchParams()
  if (opts.competitorId) params.set('competitorId', opts.competitorId)
  if (opts.projectId) params.set('projectId', opts.projectId)
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

export interface ListContentItemsOpts {
  projectId?: string
  status?: ContentItemStatus
  limit?: number
}

export async function listContentItems(
  opts: ListContentItemsOpts = {},
): Promise<ContentItemSummary[]> {
  const params = new URLSearchParams()
  if (opts.projectId) params.set('projectId', opts.projectId)
  if (opts.status) params.set('status', opts.status)
  if (opts.limit !== undefined) params.set('limit', String(opts.limit))
  const qs = params.toString()
  const path = qs ? `/content-items?${qs}` : '/content-items'
  const r = await api<ContentItemListResponse>(path)
  return r.items
}

export async function createContentItem(input: CreateContentItemInput): Promise<ContentItemSummary> {
  const r = await api<{ ok: true; item: ContentItemSummary }>('/content-items', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return r.item
}

export async function updateContentItem(
  id: string,
  patch: UpdateContentItemInput,
): Promise<ContentItemSummary> {
  const r = await api<{ ok: true; item: ContentItemSummary }>(
    `/content-items/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  )
  return r.item
}

export async function deleteContentItem(id: string): Promise<void> {
  await api<{ ok: true }>(`/content-items/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function syncContentItemMetrics(id: string): Promise<ContentItemSummary> {
  const r = await api<{ ok: true; item: ContentItemSummary }>(
    `/content-items/${encodeURIComponent(id)}/sync-metrics`,
    { method: 'POST' },
  )
  return r.item
}

export interface ListTasksOpts {
  projectId?: string
  status?: TaskStatus
  assigneeProfileId?: string
  limit?: number
}

export async function listTasks(
  opts: ListTasksOpts = {},
): Promise<TaskSummary[]> {
  const params = new URLSearchParams()
  if (opts.projectId) params.set('projectId', opts.projectId)
  if (opts.status) params.set('status', opts.status)
  if (opts.assigneeProfileId) params.set('assigneeProfileId', opts.assigneeProfileId)
  if (opts.limit !== undefined) params.set('limit', String(opts.limit))
  const qs = params.toString()
  const path = qs ? `/tasks?${qs}` : '/tasks'
  const r = await api<TaskListResponse>(path)
  return r.items
}

export async function createTask(input: CreateTaskInput): Promise<TaskSummary> {
  const r = await api<{ ok: true; task: TaskSummary }>('/tasks', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return r.task
}

export async function updateTask(
  id: string,
  patch: UpdateTaskInput,
): Promise<TaskSummary> {
  const r = await api<{ ok: true; task: TaskSummary }>(
    `/tasks/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  )
  return r.task
}

export async function deleteTask(id: string): Promise<void> {
  await api<{ ok: true }>(`/tasks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export type { TaskStatus, TaskPriority, TaskSummary }

/* ---------- ChatGPT Crawler Playground ---------- */

export interface ChatGPTConversationListItem {
  id: string
  title: string
  createTime: string
  updateTime: string
}

export interface ChatGPTMessageListItem {
  id: string
  role: string
  content: string
  createTime: string
}

export interface CdpDebugObservedResponse {
  url: string
  status?: number
  contentType?: string
  matched: boolean
  bodySize?: number
  bodyOk?: boolean
}

export interface CdpDebugInfo {
  events: string[]
  responses: CdpDebugObservedResponse[]
}

export interface ChatGPTCrawlerMeta {
  warnings: string[]
  startedAt?: string
  finishedAt?: string
  sourceUrl?: string
  debug?: CdpDebugInfo
}

export interface ChatGPTConversationsResponse {
  ok: boolean
  output: {
    conversations: ChatGPTConversationListItem[]
  }
  meta: ChatGPTCrawlerMeta
  error?: {
    code: string
    message: string
  }
}

export interface ChatGPTConversationDetailsResponse {
  ok: boolean
  output: {
    chatMessages: ChatGPTMessageListItem[]
  }
  meta: ChatGPTCrawlerMeta
  error?: {
    code: string
    message: string
  }
}

export interface ChatGPTPromptResponse {
  ok: boolean
  input: {
    conversationId?: string
  }
  output: {
    chatMessages: ChatGPTMessageListItem[]
  }
  meta: ChatGPTCrawlerMeta
  error?: {
    code: string
    message: string
  }
}

export interface ChatGPTConversationsOptions {
  profile?: 'login' | 'public' | 'flow'
  headless?: boolean
  forceHeadless?: boolean
  timeoutMs?: number
  openNewTab?: boolean
  keepTabOpen?: boolean
}

export interface ChatGPTPromptOptions {
  prompt: string
  conversationId?: string
  profile?: 'login' | 'public' | 'flow'
  headless?: boolean
  forceHeadless?: boolean
  timeoutMs?: number
  openNewTab?: boolean
  keepTabOpen?: boolean
}

export async function openChatGPTLoginChrome(): Promise<OpenCrawlerChromeResult> {
  return api<OpenCrawlerChromeResult>('/research-crawler/chrome/open', {
    method: 'POST',
    body: JSON.stringify({
      profile: 'login',
      headless: false,
      url: 'https://chatgpt.com/',
    }),
  })
}

export async function getChatGPTConversations(
  options: ChatGPTConversationsOptions = {}
): Promise<ChatGPTConversationsResponse> {
  return api<ChatGPTConversationsResponse>('/research-crawler/chatgpt/conversations', {
    method: 'POST',
    body: JSON.stringify(options),
  })
}

export async function getChatGPTConversationDetails(
  conversationId: string,
  options: ChatGPTConversationsOptions = {}
): Promise<ChatGPTConversationDetailsResponse> {
  return api<ChatGPTConversationDetailsResponse>(`/research-crawler/chatgpt/conversations/${encodeURIComponent(conversationId)}`, {
    method: 'POST',
    body: JSON.stringify(options),
  })
}

export async function sendChatGPTPrompt(
  options: ChatGPTPromptOptions
): Promise<ChatGPTPromptResponse> {
  return api<ChatGPTPromptResponse>('/research-crawler/chatgpt/prompt', {
    method: 'POST',
    body: JSON.stringify(options),
  })
}

export interface ChatGPTStreamHandlers {
  onDelta?: (text: string) => void
  signal?: AbortSignal
}

/**
 * Send a prompt and stream the assistant response via Server-Sent Events.
 * `onDelta` receives the full assistant text so far; resolves with the final
 * StandardCrawlerOutput once generation completes.
 */
export async function streamChatGPTPrompt(
  options: ChatGPTPromptOptions,
  handlers: ChatGPTStreamHandlers = {},
): Promise<ChatGPTPromptResponse> {
  const baseUrl = await getApiBaseUrl()
  const response = await fetch(new URL('/research-crawler/chatgpt/prompt/stream', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(options),
    signal: handlers.signal,
  })
  if (!response.ok || !response.body) {
    throw new Error(`Stream request failed: HTTP ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: ChatGPTPromptResponse | null = null
  let streamError: string | null = null

  // Parse the SSE wire format: events separated by blank lines, each with
  // `event:` and (possibly multiple) `data:` lines.
  const handleEvent = (raw: string) => {
    let event = 'message'
    const dataLines: string[] = []
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
    }
    if (dataLines.length === 0) return
    const data = dataLines.join('\n')
    if (event === 'delta') {
      try { handlers.onDelta?.((JSON.parse(data) as { text: string }).text) } catch { /* ignore */ }
    } else if (event === 'done') {
      try { result = JSON.parse(data) as ChatGPTPromptResponse } catch { /* ignore */ }
    } else if (event === 'error') {
      try { streamError = (JSON.parse(data) as { message?: string }).message ?? 'stream error' } catch { streamError = 'stream error' }
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      if (chunk.trim()) handleEvent(chunk)
    }
  }
  if (buffer.trim()) handleEvent(buffer)

  if (streamError) throw new Error(streamError)
  if (!result) throw new Error('Stream ended without a result.')
  return result
}

/* ---------- Qwen Crawler Playground ---------- */

// Qwen reuses the same StandardCrawlerOutput-based shapes as ChatGPT.
export type QwenConversationListItem = ChatGPTConversationListItem
export type QwenMessageListItem = ChatGPTMessageListItem
export type QwenConversationsResponse = ChatGPTConversationsResponse
export type QwenConversationDetailsResponse = ChatGPTConversationDetailsResponse
export type QwenPromptResponse = ChatGPTPromptResponse
export type QwenConversationsOptions = ChatGPTConversationsOptions
export type QwenPromptOptions = ChatGPTPromptOptions

export async function openQwenLoginChrome(): Promise<OpenCrawlerChromeResult> {
  return api<OpenCrawlerChromeResult>('/research-crawler/chrome/open', {
    method: 'POST',
    body: JSON.stringify({
      profile: 'login',
      headless: false,
      url: 'https://chat.qwen.ai/',
    }),
  })
}

export async function getQwenConversations(
  options: QwenConversationsOptions = {}
): Promise<QwenConversationsResponse> {
  return api<QwenConversationsResponse>('/research-crawler/qwen/conversations', {
    method: 'POST',
    body: JSON.stringify(options),
  })
}

export async function getQwenConversationDetails(
  conversationId: string,
  options: QwenConversationsOptions = {}
): Promise<QwenConversationDetailsResponse> {
  return api<QwenConversationDetailsResponse>(`/research-crawler/qwen/conversations/${encodeURIComponent(conversationId)}`, {
    method: 'POST',
    body: JSON.stringify(options),
  })
}

/**
 * Send a prompt to Qwen and stream the assistant response via Server-Sent Events.
 * `onDelta` receives the full assistant text so far; resolves with the final
 * StandardCrawlerOutput once generation completes.
 */
export async function streamQwenPrompt(
  options: QwenPromptOptions,
  handlers: ChatGPTStreamHandlers = {},
): Promise<QwenPromptResponse> {
  const baseUrl = await getApiBaseUrl()
  const response = await fetch(new URL('/research-crawler/qwen/prompt/stream', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(options),
    signal: handlers.signal,
  })
  if (!response.ok || !response.body) {
    throw new Error(`Stream request failed: HTTP ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: QwenPromptResponse | null = null
  let streamError: string | null = null

  const handleEvent = (raw: string) => {
    let event = 'message'
    const dataLines: string[] = []
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
    }
    if (dataLines.length === 0) return
    const data = dataLines.join('\n')
    if (event === 'delta') {
      try { handlers.onDelta?.((JSON.parse(data) as { text: string }).text) } catch { /* ignore */ }
    } else if (event === 'done') {
      try { result = JSON.parse(data) as QwenPromptResponse } catch { /* ignore */ }
    } else if (event === 'error') {
      try { streamError = (JSON.parse(data) as { message?: string }).message ?? 'stream error' } catch { streamError = 'stream error' }
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      if (chunk.trim()) handleEvent(chunk)
    }
  }
  if (buffer.trim()) handleEvent(buffer)

  if (streamError) throw new Error(streamError)
  if (!result) throw new Error('Stream ended without a result.')
  return result
}

/* -----------------------------------------------------------
   Google Flow (labs.google) image generation — headed `flow`
   profile. See docs/flow-crawler-cdp.md.
   ----------------------------------------------------------- */

export type FlowRatio = '16:9' | '4:3' | '1:1' | '3:4' | '9:16'
export type FlowVariations = 1 | 2 | 3 | 4

export interface FlowGenerateOptions {
  prompt: string
  /** A Flow project URL (…/tools/flow/project/<id>) to open before generating. */
  projectUrl?: string
  ratio?: FlowRatio
  variations?: FlowVariations
  model?: string
  generateTimeoutMs?: number
  downloadDir?: string
  downloadFilePrefix?: string
  skipReset?: boolean
}

export interface FlowGenerateResponse {
  ok: true
  chromeOrigin: string
  tabUrl: string
  prompt: string
  ratio: FlowRatio
  variations: FlowVariations
  model: string
  resultEditUrls: string[]
  downloadedImagePaths?: string[]
}

/** Launch (or reveal) the headed `flow` Chrome on a Flow project so the user can log in. */
export async function openFlowChrome(projectUrl?: string): Promise<OpenCrawlerChromeResult> {
  return api<OpenCrawlerChromeResult>('/research-crawler/chrome/open', {
    method: 'POST',
    body: JSON.stringify({
      profile: 'flow',
      headless: false,
      url: projectUrl ?? 'https://labs.google/fx/tools/flow',
    }),
  })
}

export async function generateFlowImage(options: FlowGenerateOptions): Promise<FlowGenerateResponse> {
  return api<FlowGenerateResponse>('/research-crawler/flow/generate', {
    method: 'POST',
    body: JSON.stringify(options),
  })
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const r = await api<ProjectListResponse>('/projects')
  return r.items
}

export async function createProject(input: CreateProjectInput): Promise<ProjectSummary> {
  const r = await api<{ ok: true; project: ProjectSummary }>('/projects', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return r.project
}

export async function updateProject(id: string, patch: UpdateProjectInput): Promise<ProjectSummary> {
  const r = await api<{ ok: true; project: ProjectSummary }>(`/projects/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  return r.project
}

export async function deleteProject(id: string): Promise<void> {
  await api<{ ok: true }>(`/projects/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

/* ---------- Knowledge Base ---------- */

export interface IndexKnowledgeBaseInput {
  projectId: string
  paths?: string[]
}

export interface IndexKnowledgeBaseResult {
  workdirId: string
  createdIgnoreFile: boolean
  indexed: string[]
}

export async function indexKnowledgeBase(input: IndexKnowledgeBaseInput): Promise<IndexKnowledgeBaseResult> {
  const r = await api<{ ok: true } & IndexKnowledgeBaseResult>('/knowledge-base/index', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return { workdirId: r.workdirId, createdIgnoreFile: r.createdIgnoreFile, indexed: r.indexed }
}

export async function searchKnowledgeBase(input: {
  projectId: string
  query: string
  limit?: number
  depth?: number
}): Promise<{ query: string; hits: KnowledgeBaseSearchHit[] }> {
  const r = await api<{ ok: true; query: string; hits: KnowledgeBaseSearchHit[] }>(
    '/knowledge-base/search',
    { method: 'POST', body: JSON.stringify(input) },
  )
  return { query: r.query, hits: r.hits }
}

export async function getKnowledgeBaseStats(projectId: string): Promise<KnowledgeBaseStats> {
  const params = new URLSearchParams({ projectId })
  const r = await api<{ ok: true } & KnowledgeBaseStats>(`/knowledge-base/stats?${params}`)
  return {
    documentCount: r.documentCount,
    chunkCount: r.chunkCount,
    entityCount: r.entityCount,
    edgeCount: r.edgeCount,
    lastIndexedAt: r.lastIndexedAt,
  }
}

export async function listKnowledgeBaseDocuments(projectId: string): Promise<KnowledgeBaseDocument[]> {
  const params = new URLSearchParams({ projectId })
  const r = await api<{ ok: true; items: KnowledgeBaseDocument[] }>(`/knowledge-base/documents?${params}`)
  return r.items
}

export async function getKnowledgeBaseGraph(projectId: string, limit?: number): Promise<KnowledgeBaseGraph> {
  const params = new URLSearchParams({ projectId })
  if (limit !== undefined) params.set('limit', String(limit))
  const r = await api<{ ok: true } & KnowledgeBaseGraph>(`/knowledge-base/graph?${params}`)
  return { nodes: r.nodes, edges: r.edges }
}

export async function getKnowledgeBaseNeighborhood(input: {
  projectId: string
  chunkId: string
  depth?: number
  limit?: number
}): Promise<KnowledgeBaseGraph> {
  const params = new URLSearchParams({ projectId: input.projectId, chunkId: input.chunkId })
  if (input.depth !== undefined) params.set('depth', String(input.depth))
  if (input.limit !== undefined) params.set('limit', String(input.limit))
  const r = await api<{ ok: true } & KnowledgeBaseGraph>(`/knowledge-base/graph/neighborhood?${params}`)
  return { nodes: r.nodes, edges: r.edges }
}

export async function getKnowledgeBaseIgnoreFile(projectId: string): Promise<{
  exists: boolean
  path: string
  content: string
}> {
  const params = new URLSearchParams({ projectId })
  const r = await api<{ ok: true; exists: boolean; path: string; content: string }>(
    `/knowledge-base/ignore-file?${params}`,
  )
  return { exists: r.exists, path: r.path, content: r.content }
}

/* ---------- Extractor ---------- */

export async function runOcr(input: { path: string; force?: boolean }): Promise<OcrResult> {
  const r = await api<{ ok: true; result: OcrResult }>('/extractor/ocr', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return r.result
}

export async function runTranscribe(input: {
  path: string
  language?: string
  whisperModel?: WhisperModel
  force?: boolean
}): Promise<TranscribeResult> {
  const r = await api<{ ok: true; result: TranscribeResult }>('/extractor/transcribe', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return r.result
}

/**
 * Kick off a workspace-wide extraction as a background job. Scans the
 * active project's workdir (respecting `.anubisignore`), then OCRs
 * images and/or transcribes audio/video. Returns the job id; monitor
 * progress via {@link streamJobs} / {@link listJobs} (top-nav progress).
 */
export async function extractWorkspace(input: {
  projectId: string
  images?: boolean
  media?: boolean
  force?: boolean
  language?: string
  whisperModel?: WhisperModel
}): Promise<{ jobId: string }> {
  const r = await api<{ ok: true; jobId: string }>('/extractor/workspace', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return { jobId: r.jobId }
}

/* ---------- project snapshot import/export ---------- */

export async function exportProjectSnapshot(projectId?: string): Promise<ProjectSnapshot> {
  const path = projectId
    ? `/snapshot/export?projectId=${encodeURIComponent(projectId)}`
    : '/snapshot/export'
  const r = await api<{ ok: true; snapshot: ProjectSnapshot }>(path)
  return r.snapshot
}

export async function importProjectSnapshot(
  input: ImportSnapshotInput,
): Promise<ImportSnapshotResult> {
  return api<ImportSnapshotResult>('/snapshot/import', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}


/* ------------------------------------------------------------------ *
 * Content pipeline (idea → human_review)
 * ------------------------------------------------------------------ */

export async function saveCandidateAsIdea(candidateId: string, projectId?: string): Promise<ContentItemSummary> {
  const r = await api<{ ok: true; item: ContentItemSummary }>('/content-items/from-candidate', {
    method: 'POST',
    body: JSON.stringify({ candidateId, projectId }),
  })
  return r.item
}

export async function extractRawIdea(id: string): Promise<ContentPipeline> {
  const r = await api<{ ok: true; pipeline: ContentPipeline }>(
    `/content-items/${encodeURIComponent(id)}/extract`,
    { method: 'POST' },
  )
  return r.pipeline
}

export async function getContentPipeline(id: string): Promise<{ pipeline: ContentPipeline; lessons: ContentLesson[] }> {
  const r = await api<{ ok: true; pipeline: ContentPipeline; lessons: ContentLesson[] }>(
    `/content-items/${encodeURIComponent(id)}/pipeline`,
  )
  return { pipeline: r.pipeline, lessons: r.lessons }
}

export async function runPipeline(id: string): Promise<string> {
  const r = await api<{ ok: true; jobId: string }>(
    `/content-items/${encodeURIComponent(id)}/pipeline/run`,
    { method: 'POST' },
  )
  return r.jobId
}

export async function runPipelineStep(
  id: string,
  step: 'breakdown' | 'refine' | 'ai-review',
): Promise<{ brief?: ImprovedBrief; refined?: RefinedContent; review?: AiReview }> {
  return api<{ ok: true; brief?: ImprovedBrief; refined?: RefinedContent; review?: AiReview }>(
    `/content-items/${encodeURIComponent(id)}/pipeline/step/${step}`,
    { method: 'POST' },
  )
}

export async function submitHumanReview(
  id: string,
  input: { decision: 'approved' | 'rejected'; reason?: string; type?: string },
): Promise<HumanReview> {
  const r = await api<{ ok: true; review: HumanReview }>(
    `/content-items/${encodeURIComponent(id)}/human-review`,
    { method: 'POST', body: JSON.stringify(input) },
  )
  return r.review
}

export async function listLessons(projectId?: string): Promise<ContentLesson[]> {
  const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
  const r = await api<{ ok: true; lessons: ContentLesson[] }>(`/lessons${qs}`)
  return r.lessons
}

export async function getBrandContext(projectId?: string): Promise<BrandContext> {
  const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
  const r = await api<{ ok: true; brandContext: BrandContext }>(`/brand-context${qs}`)
  return r.brandContext
}

export async function saveBrandContext(
  projectId: string,
  fields: Omit<BrandContext, 'projectId' | 'updatedAt'>,
): Promise<BrandContext> {
  const r = await api<{ ok: true; brandContext: BrandContext }>(
    `/brand-context?projectId=${encodeURIComponent(projectId)}`,
    { method: 'PUT', body: JSON.stringify(fields) },
  )
  return r.brandContext
}
