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

export type AgentKind = 'claude' | 'codex' | 'antigravity' | 'gpt-web' | 'qwen-web' | 'qoder'
export type ProfileSource = 'builtin' | 'user'
export type ConversationStatus = 'pending' | 'running' | 'finished' | 'error'
export type MessageRole = 'user' | 'assistant' | 'system'
export type ContentItemStatus =
  | 'idea'
  | 'raw_extracted'
  | 'brief'
  | 'content_refined'
  | 'ai_review'
  | 'human_review'
  | 'generating'
  | 'draft'
  | 'review'
  | 'scheduled'
  | 'published'
  | 'rejected'
export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type SkillSource =
  | 'builtin-auto'
  | 'builtin-opt-in'
  | 'user-auto'
  | 'user-opt-in'
  | 'user'

export interface AgentAvailability {
  available: boolean
  path?: string
  source: 'detected' | 'env-override'
}

export interface ProfileHomeInfo {
  /** Absolute path to the profile's isolated agent home directory. */
  path: string
  /** True if the directory has been created (i.e. the profile has been used at least once). */
  exists: boolean
  /** True if the profile currently has active credentials. */
  hasCredentials: boolean
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
  source?: 'workflow'
  workflow?: {
    runId: string
    nodeId: string
  }
}

export interface ConversationSummary {
  id: string
  title: string
  agent: AgentKind
  status: ConversationStatus
  profileId?: string
  projectId?: string
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

export interface MessageImageReference {
  src: string
  alt?: string
  label?: string
  mimeType?: string
  source?: 'markdown' | 'path' | 'metadata' | 'tool'
}

const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp)(?:[?#].*)?$/i
const EMBEDDED_IMAGE_RE = /^(?:data:image\/|blob:)/i
const REMOTE_URL_RE = /^https?:/i

export function isImageReferenceSource(value: string): boolean {
  const trimmed = value.trim()
  return EMBEDDED_IMAGE_RE.test(trimmed) || IMAGE_EXT_RE.test(trimmed)
}

/**
 * Whether a bare, unlabelled string should be treated as an image reference.
 * Requires the trimmed value to be a single token (no internal whitespace) so
 * that multi-token free text — `ls -la` output, prose sentences — that merely
 * ends in an image extension is not mistaken for an image path.
 */
function isBareImagePathString(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed || /\s/.test(trimmed)) return false
  return isImageReferenceSource(trimmed)
}

export function imageFilenameFromSource(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('data:image/')) return 'generated image'
  try {
    const url = new URL(trimmed)
    const name = url.pathname.split('/').filter(Boolean).pop()
    return name ? decodeURIComponent(name) : trimmed
  } catch {
    const cleaned = trimmed.split(/[?#]/, 1)[0] ?? trimmed
    return cleaned.split(/[/\\]/).filter(Boolean).pop() ?? cleaned
  }
}

export function extractImageReferencesFromUnknown(value: unknown): MessageImageReference[] {
  const out: MessageImageReference[] = []
  const seen = new Set<string>()

  const add = (ref: MessageImageReference) => {
    const src = ref.src.trim()
    if (!src || seen.has(src)) return
    const trustedRemote =
      ref.source === 'metadata' &&
      REMOTE_URL_RE.test(src)
    if (!isImageReferenceSource(src) && !trustedRemote) return
    seen.add(src)
    out.push({
      ...ref,
      src,
      label: ref.label ?? imageFilenameFromSource(src),
    })
  }

  const visit = (node: unknown, depth: number) => {
    if (depth > 8 || node == null) return
    if (typeof node === 'string') {
      // A free-text string (tool stdout, prose) is only an image source when
      // the whole value is a single path/URL token. Reject multi-token lines
      // like `ls -la` output that merely end in an image extension. Structured
      // fields (path/src/...) keep their own handling below.
      if (isBareImagePathString(node)) add({ src: node, source: 'tool' })
      return
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1)
      return
    }
    if (typeof node !== 'object') return

    const obj = node as Record<string, unknown>
    const alt = stringProp(obj, ['alt', 'altText', 'description', 'caption', 'title'])
    const label = stringProp(obj, ['label', 'name', 'filename', 'fileName'])
    const mimeType = stringProp(obj, ['mimeType', 'mediaType', 'contentType'])
    const direct = stringPropWithKey(obj, [
      'image',
      'imageUrl',
      'imageUri',
      'imagePath',
      'src',
      'url',
      'uri',
      'href',
      'path',
      'filePath',
      'filepath',
      'localPath',
      'absolutePath',
      'source',
    ])
    if (direct && isStructuredImageSource(direct.key, direct.value, mimeType)) {
      add({ src: direct.value, alt, label, mimeType, source: 'metadata' })
    }

    const base64 = stringProp(obj, ['base64', 'b64_json', 'data'])
    if (base64 && mimeType?.startsWith('image/') && !base64.startsWith('data:')) {
      add({ src: `data:${mimeType};base64,${base64}`, alt, label, mimeType, source: 'metadata' })
    }

    for (const child of Object.values(obj)) visit(child, depth + 1)
  }

  visit(value, 0)
  return out
}

function stringProp(obj: Record<string, unknown>, keys: string[]): string | undefined {
  return stringPropWithKey(obj, keys)?.value
}

function stringPropWithKey(
  obj: Record<string, unknown>,
  keys: string[],
): { key: string; value: string } | undefined {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.trim()) return { key, value: value.trim() }
  }
  return undefined
}

function isStructuredImageSource(key: string, value: string, mimeType?: string): boolean {
  if (isImageReferenceSource(value)) return true
  if (mimeType?.startsWith('image/') && REMOTE_URL_RE.test(value)) return true
  return key.toLowerCase().startsWith('image') && REMOTE_URL_RE.test(value)
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

export type CronActionType = 'message' | 'competitor-discovery' | 'capture-posts' | 'workflow'
export type CronCaptureProfile = 'public' | 'login'

export interface CompetitorDiscoveryCronConfig {
  projectId: string
  /**
   * One of:
   * - `explore`
   * - `#hashtag`
   * - freeform keyword text
   */
  query: string
  captureProfile: CronCaptureProfile
  defaultLevel?: CompetitorLevelOverride
}

export interface CapturePostsCronConfig {
  projectId: string
  handles: 'all' | string[]
  captureProfile: CronCaptureProfile
  postLimit?: number
}

export interface WorkflowCronConfig {
  /** Resolve the workflow by id first; falls back to `workflowName` within `projectId` scope. */
  workflowId?: string
  /** Friendly name lookup, used when `workflowId` is omitted. */
  workflowName?: string
  /** Project scope used to disambiguate a name lookup. */
  projectId?: string
  /**
   * Optional per-node data overrides applied to the published graph on run,
   * forwarded verbatim to the workflow run path (same shape as the manual
   * "run workflow" override payload). Keyed by node id.
   */
  input?: Record<string, unknown>
}

export type CronActionConfig =
  | CompetitorDiscoveryCronConfig
  | CapturePostsCronConfig
  | WorkflowCronConfig

export interface CronJobSummary {
  id: string
  conversationId: string
  projectId?: string
  name: string
  schedule: string
  scheduleDescription?: string
  actionType: CronActionType
  actionConfig?: CronActionConfig
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
  actionType?: CronActionType
  actionConfig?: CronActionConfig
  prompt?: string
  enabled?: boolean
}

export type CompetitorStatus = 'active' | 'paused' | 'archived'

export interface CompetitorSummary {
  id: string
  handle: string
  projectId?: string
  displayName?: string
  niche?: string
  tint?: string
  followers?: number
  avgLikes?: number
  postCount: number
  lastRefreshedAt?: number
  notes?: string
  bio?: string
  level?: CompetitorLevelOverride
  platform?: string
  status?: CompetitorStatus
  favorite?: boolean
  baselineLikes?: number
  baselineSampleSize?: number
  baselineUpdatedAt?: number
  addedAt: number
  updatedAt: number
}

export interface CreateCompetitorInput {
  handle: string
  projectId?: string
  displayName?: string
  niche?: string
  tint?: string
  followers?: number
  avgLikes?: number
  notes?: string
  bio?: string
  level?: CompetitorLevelOverride
  platform?: string
  status?: CompetitorStatus
  favorite?: boolean
}

export interface UpdateCompetitorInput {
  displayName?: string
  niche?: string
  tint?: string
  followers?: number
  avgLikes?: number
  postCount?: number
  notes?: string
  bio?: string
  level?: CompetitorLevelOverride | null
  platform?: string
  status?: CompetitorStatus
  favorite?: boolean
}

export interface UpdateCapturedPostInput {
  caption?: string
  likes?: number
  comments?: number
  postedAt?: string
  mediaKind?: 'image' | 'video' | 'carousel'
  mediaUrl?: string
  carouselCount?: number
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
  headless?: boolean
  /** Required when running the 'login' profile headless. */
  forceHeadless?: boolean
}

export interface AppConfig {
  /** Path to chrome.exe / Chrome binary, when not on PATH. */
  chromePath?: string
  /** Optional research-crawler project/data root whose Chrome profiles should be reused. */
  crawlerProfileRoot?: string
  /** Follower-count bands that drive the competitor level badge. */
  competitorLevels?: CompetitorLevelsConfig
  /** Viral-multiplier thresholds (post likes ÷ avgLikes) per competitor level. */
  levelMultipliers?: LevelMultipliersConfig
  /** Path to the `anubis-engine` binary that backs Knowledge Base. */
  engineBinaryPath?: string
  /** Path to the `anubis-extractor` binary used for OCR and audio/video transcription. */
  extractorBinaryPath?: string
  /** Whether local notifications are enabled. */
  enableNotifications?: boolean
  /** Whether the prompt improvement and context injection middleware hook is enabled. */
  enableContextInjection?: boolean
  /** The agent profile ID to use for context building and prompt improvement. */
  contextInjectionProfileId?: string
  /** Qoder personal access token stored in settings (preferred over QODER_PERSONAL_ACCESS_TOKEN env var). */
  qoderApiKey?: string
  /** Project-level AI profile assignments for Content Studio pipeline steps. */
  pipelineStepProfiles?: PipelineStepProfileConfig
}

/* ============================================================
   Knowledge Base
   ============================================================ */

export interface KnowledgeBaseStats {
  documentCount: number
  chunkCount: number
  entityCount: number
  edgeCount: number
  lastIndexedAt?: number
}

export interface KnowledgeBaseDocument {
  id: string
  path: string
  chunkCount?: number
  indexedAt?: number
}

export interface KnowledgeBaseSearchHit {
  chunkId: string
  docId: string
  path: string
  score?: number
  snippet: string
}

export interface KnowledgeBaseSearchResponse {
  ok: true
  query: string
  hits: KnowledgeBaseSearchHit[]
  raw?: unknown
}

export interface KnowledgeBaseIndexResult {
  ok: true
  indexed: string[]
  workdirId: string
  createdIgnoreFile: boolean
}

export interface KnowledgeBaseContextPackResponse {
  ok: true
  query: string
  text: string
  raw?: unknown
}

export interface KnowledgeBaseGraphNode {
  id: string
  docId: string
  filename: string
  content: string
  page?: number
  degree: number
  docClass?: string
  chunkSignal?: string
}

export interface KnowledgeBaseGraphEdge {
  src: string
  dst: string
  weight: number
  edgeType: string
  reason?: string
}

export interface KnowledgeBaseGraph {
  nodes: KnowledgeBaseGraphNode[]
  edges: KnowledgeBaseGraphEdge[]
}

/* ============================================================
   Extractor
   ============================================================ */

export type WhisperModel = 'tiny' | 'base' | 'small' | 'medium' | 'large-v3'

export const DEFAULT_WHISPER_MODEL: WhisperModel = 'large-v3'

export interface OcrLine {
  bbox?: [number, number, number, number]
  text: string
}

export interface OcrResult {
  text: string
  lines: OcrLine[]
  sidecarPath?: string
  cacheHit?: boolean
}

export interface TranscriptSegment {
  startMs: number
  endMs: number
  text: string
}

export interface TranscribeResult {
  text: string
  segments: TranscriptSegment[]
  language?: string
  sidecarPath?: string
  cacheHit?: boolean
}

/* ============================================================
   Competitor levels
   ============================================================
   Five visible buckets derived live from `followers`. Two "black"
   regions (below minActive and above maxActive) collapse to a
   single 'black' value; the UI distinguishes them in tooltips.
   ============================================================ */

export type CompetitorLevel = 'black' | 'green' | 'yellow' | 'red' | 'unknown'

export interface CompetitorLevelsConfig {
  minActive: number
  greenMax: number
  yellowMax: number
  maxActive: number
}

export const DEFAULT_COMPETITOR_LEVELS: CompetitorLevelsConfig = {
  minActive: 10_000,
  greenMax: 40_000,
  yellowMax: 1_000_000,
  // Effectively unbounded: any account over yellowMax reads as 'red'. The upper
  // 'black' region only triggers above this ceiling, which no real account hits.
  maxActive: 1_000_000_000,
}

export function levelFor(
  followers: number | null | undefined,
  cfg: CompetitorLevelsConfig = DEFAULT_COMPETITOR_LEVELS,
): CompetitorLevel {
  if (followers == null) return 'unknown'
  if (followers < cfg.minActive || followers > cfg.maxActive) return 'black'
  if (followers <= cfg.greenMax) return 'green'
  if (followers <= cfg.yellowMax) return 'yellow'
  return 'red'
}

/** The manually-selectable levels — `'unknown'` is computed-only. */
export type CompetitorLevelOverride = Exclude<CompetitorLevel, 'unknown'>

/**
 * The level actually shown for a competitor: a manual override wins;
 * otherwise the follower-count-derived level is used.
 */
export function effectiveLevel(
  override: CompetitorLevelOverride | null | undefined,
  followers: number | null | undefined,
  cfg: CompetitorLevelsConfig = DEFAULT_COMPETITOR_LEVELS,
): CompetitorLevel {
  return override ?? levelFor(followers, cfg)
}

export function isValidCompetitorLevels(cfg: CompetitorLevelsConfig): boolean {
  return (
    Number.isInteger(cfg.minActive) &&
    Number.isInteger(cfg.greenMax) &&
    Number.isInteger(cfg.yellowMax) &&
    Number.isInteger(cfg.maxActive) &&
    cfg.minActive > 0 &&
    cfg.minActive < cfg.greenMax &&
    cfg.greenMax < cfg.yellowMax &&
    cfg.yellowMax < cfg.maxActive
  )
}

/* ============================================================
   Level multipliers
   ============================================================
   Rates an individual captured post by its "viral multiplier"
   (post likes ÷ the owning competitor's avgLikes). The
   competitor's effective level selects a threshold band; the
   multiplier then buckets the post into green / yellow / red.
   Posts that can't be scored (competitor not green/yellow/red,
   or missing/zero avgLikes / missing likes) are 'unrated'.
   ============================================================ */

/** A threshold band: `min` is the yellow floor, `good` is the green floor. */
export interface MultiplierBand {
  min: number
  good: number
}

export interface LevelMultipliersConfig {
  green: MultiplierBand
  yellow: MultiplierBand
  red: MultiplierBand
}

export const DEFAULT_LEVEL_MULTIPLIERS: LevelMultipliersConfig = {
  green: { min: 5, good: 10 },
  yellow: { min: 10, good: 15 },
  red: { min: 15, good: 20 },
}

export type MultiplierRating = 'green' | 'yellow' | 'red' | 'unrated'

/** The competitor levels that carry a multiplier band. */
type RatedLevel = 'green' | 'yellow' | 'red'

function isRatedLevel(level: CompetitorLevel): level is RatedLevel {
  return level === 'green' || level === 'yellow' || level === 'red'
}

/**
 * Rate a post by post-likes ÷ competitor-avgLikes against the band
 * for the competitor's (effective) level. Pass the effective level so
 * a manual competitor override drives which band is used.
 */
export function multiplierRatingFor(
  competitorLevel: CompetitorLevel,
  postLikes: number | null | undefined,
  avgLikes: number | null | undefined,
  cfg: LevelMultipliersConfig = DEFAULT_LEVEL_MULTIPLIERS,
): { rating: MultiplierRating; multiplier: number | null } {
  if (!isRatedLevel(competitorLevel)) return { rating: 'unrated', multiplier: null }
  if (postLikes == null || avgLikes == null || avgLikes <= 0) {
    return { rating: 'unrated', multiplier: null }
  }
  const multiplier = postLikes / avgLikes
  const band = cfg[competitorLevel]
  if (multiplier >= band.good) return { rating: 'green', multiplier }
  if (multiplier >= band.min) return { rating: 'yellow', multiplier }
  return { rating: 'red', multiplier }
}

function isValidBand(band: MultiplierBand): boolean {
  return (
    Number.isFinite(band.min) &&
    Number.isFinite(band.good) &&
    band.min > 0 &&
    band.good > 0 &&
    band.min < band.good
  )
}

export function isValidLevelMultipliers(cfg: LevelMultipliersConfig): boolean {
  return isValidBand(cfg.green) && isValidBand(cfg.yellow) && isValidBand(cfg.red)
}

/* ============================================================
   Candidate scoring (Research Phase)
   ============================================================
   score = postLikes / competitorBaselineLikes. The candidate level
   depends on the competitor's level band — see getCandidateLevel.
   ============================================================ */

export type CandidateLevel = 'green' | 'yellow' | 'neutral'

/** post likes ÷ baseline likes; null when either is missing/non-finite or baseline <= 0. */
export function scoreFor(
  postLikes: number | null | undefined,
  baselineLikes: number | null | undefined,
): number | null {
  if (postLikes == null || baselineLikes == null) return null
  if (!Number.isFinite(postLikes) || !Number.isFinite(baselineLikes)) return null
  if (baselineLikes <= 0) return null
  return postLikes / baselineLikes
}

/**
 * Candidate level from a multiplier score and the owning competitor's level.
 * Thresholds rise with competitor size; red competitors can never yield 'green'
 * (massive distribution = inspiration signal, not direct validation).
 */
export function getCandidateLevel(score: number, competitorLevel: CompetitorLevel): CandidateLevel {
  if (competitorLevel === 'green') {
    if (score >= 10) return 'green'
    if (score >= 5) return 'yellow'
    return 'neutral'
  }
  if (competitorLevel === 'yellow') {
    if (score >= 20) return 'green'
    if (score >= 10) return 'yellow'
    return 'neutral'
  }
  if (competitorLevel === 'red') {
    if (score >= 20) return 'yellow'
    return 'neutral'
  }
  return 'neutral'
}

/**
 * Median of like counts, rounded. Non-finite/negative values are dropped.
 * The viral-resistant baseline ("typical" likes) for a competitor. Returns null
 * for an empty input (no average fallback is possible without samples).
 */
export function medianLikes(values: number[]): number | null {
  const clean = values
    .filter((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0)
    .sort((a, b) => a - b)
  if (clean.length === 0) return null
  const mid = Math.floor(clean.length / 2)
  const median = clean.length % 2 === 1 ? clean[mid]! : (clean[mid - 1]! + clean[mid]!) / 2
  return Math.round(median)
}

/* ============================================================
   Candidate validation (Research Phase)
   ============================================================ */

export type CandidateValidationStatus = 'valid' | 'invalid' | 'pending'
export type CandidateValidationRule = 'recency' | 'niche' | 'score' | 'source'

export interface CandidateValidationArgs {
  postedAt?: string
  baselineLikes?: number | null
  score?: number | null
  competitorActive: boolean
  /** true = aligned, false = not aligned, null/undefined = not yet judged. */
  nicheAligned?: boolean | null
  maxContentAgeDays: number
  nowMs: number
}

export interface CandidateValidationResult {
  status: CandidateValidationStatus
  failures: CandidateValidationRule[]
}

/**
 * A candidate is valid only if recency, score, source, and niche all pass.
 * Niche being unresolved (null) yields 'pending' — unless a hard rule already
 * failed, in which case the candidate is 'invalid'.
 */
export function evaluateCandidateValidation(args: CandidateValidationArgs): CandidateValidationResult {
  const failures: CandidateValidationRule[] = []

  const postedMs = args.postedAt ? Date.parse(args.postedAt) : NaN
  const maxAgeMs = args.maxContentAgeDays * 24 * 60 * 60 * 1000
  const recencyOk = Number.isFinite(postedMs) && postedMs >= args.nowMs - maxAgeMs
  if (!recencyOk) failures.push('recency')

  const scoreOk =
    args.baselineLikes != null && args.baselineLikes > 0 &&
    args.score != null && Number.isFinite(args.score) && args.score > 0
  if (!scoreOk) failures.push('score')

  if (!args.competitorActive) failures.push('source')

  if (args.nicheAligned === false) failures.push('niche')

  if (failures.length > 0) return { status: 'invalid', failures }
  if (args.nicheAligned == null) return { status: 'pending', failures: [] }
  return { status: 'valid', failures: [] }
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
  projectId?: string
  workspacePath?: string
  agent?: AgentKind
  override?: Record<string, unknown>
}

export interface WorkspaceSummary {
  /** Absolute path to a previously used working directory. */
  path: string
  /** Epoch ms of the last time a conversation used this folder. */
  lastUsedAt: number
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
export type WorkspaceListResponse = ListResponse<WorkspaceSummary>

export interface ProjectSummary {
  id: string
  name: string
  emoji?: string
  color?: string
  description?: string
  workdir?: string
  createdAt: number
  updatedAt: number
}
export interface CreateProjectInput {
  name: string
  emoji?: string
  color?: string
  description?: string
  workdir?: string
}
export interface UpdateProjectInput {
  name?: string
  emoji?: string
  color?: string
  description?: string
  workdir?: string
}
export type ProjectListResponse = ListResponse<ProjectSummary>

export interface CapturedPostSummary {
  id: string
  competitorId: string
  projectId?: string
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
  /** Owning competitor's follower count, joined in by the route layer. */
  competitorFollowers?: number
  /** Owning competitor's avgLikes, joined in by the route layer. */
  competitorAvgLikes?: number
  /** Owning competitor's manual level override, joined in by the route layer. */
  competitorLevel?: CompetitorLevelOverride
}

export type CapturedPostListResponse = ListResponse<CapturedPostSummary>

export interface ContentItemAnalytics {
  likes?: number
  comments?: number
  saves?: number
  syncedAt?: number
}

export interface ContentItemSummary {
  id: string
  projectId?: string
  referencePostId?: string
  referenceUrl?: string
  title: string
  status: ContentItemStatus
  rawBrief?: string
  improvedDraft?: string
  rejectionReason?: string
  publishedUrl?: string
  publishedAt?: string
  analytics: ContentItemAnalytics
  sourceWorkflowRunId?: string
  sourceConversationId?: string
  sourceCandidateId?: string
  createdAt: number
  updatedAt: number
  referencePost?: CapturedPostSummary
}

export interface CreateContentItemInput {
  projectId?: string
  referencePostId?: string
  referenceUrl?: string
  title: string
  status?: ContentItemStatus
  rawBrief?: string
  improvedDraft?: string
  sourceWorkflowRunId?: string
  sourceConversationId?: string
  sourceCandidateId?: string
}

export interface UpdateContentItemInput {
  title?: string
  status?: ContentItemStatus
  rawBrief?: string
  improvedDraft?: string
  rejectionReason?: string | null
  publishedUrl?: string | null
  publishedAt?: string | null
  analytics?: {
    likes?: number | null
    comments?: number | null
    saves?: number | null
  }
  sourceWorkflowRunId?: string | null
  sourceConversationId?: string | null
}

export type ContentItemListResponse = ListResponse<ContentItemSummary>

/* ============================================================
   Content pipeline (Phase 1: idea → human_review)
   ============================================================ */

export type LessonSource = 'ai_review' | 'human_review' | 'generation_failure' | 'final_draft_review'
export type LessonType =
  | 'brand_alignment'
  | 'tone_of_voice'
  | 'niche_alignment'
  | 'content_quality'
  | 'visual_quality'
  | 'copywriting_quality'
  | 'technical_generation_error'

export interface ContentLesson {
  id: string
  projectId: string
  contentId: string
  source: LessonSource
  type: LessonType
  reason: string
  whatWentWrong: string
  howToImprove: string
  relatedBrandRule?: string
  relatedToneRule?: string
  relatedNicheRule?: string
  createdAt: number
}

/** A reference-post media file downloaded to the item's pipeline working dir. */
export interface LocalAsset {
  kind: 'image' | 'video'
  /** Basename within the item's assets dir, e.g. "0.jpg", "video.mp4". */
  fileName: string
  /** Absolute path on the backend host. */
  path: string
  /** Original media URL it was downloaded from (absent when reused from cache). */
  sourceUrl?: string
}

export interface RawIdea {
  caption?: string
  assetRefs: string[]
  sourceUrl?: string
  sourcePlatform?: string
  sourceCompetitor?: string
  mediaKind?: 'image' | 'video' | 'carousel'
  mediaMetadata?: Record<string, unknown>
  transcript?: string
  /** Media downloaded at extract: all carousel slides / the image / the video. */
  localAssets?: LocalAsset[]
}

export interface ImprovedBrief {
  coreIdea: string
  targetAudience: string
  marketFit: string
  problem: string
  mainMessage: string
  contentAngle: string
  hookDirection: string
  brandAlignmentNotes: string
  toneDirection: string
  adaptationStrategy: string
  riskNotes: string
  referenceLessons: string[]
}

export interface VisualBrief {
  concept: string
  sceneDirection: string
  subject: string
  layout: string
  mood: string
  style: string
  keyElements: string[]
  textOverlay?: string
  negativeDirection?: string
}

export interface Copywriting {
  hook: string
  body: string
  cta: string
  textOverlay?: string
  carouselSlides?: string[]
  videoScript?: string
}

export interface Hashtags {
  primary: string[]
  niche: string[]
  brandSafe: string[]
  platformNotes?: string
}

export interface RefinedContent {
  caption: string
  visualBrief: VisualBrief
  copywriting: Copywriting
  hashtags: Hashtags
  platformNotes?: string
}

export interface AiReviewChecklistItem {
  criterion: string
  pass: boolean
  note?: string
}

export interface AiReview {
  decision: 'approved' | 'rejected'
  score?: number
  checklist: AiReviewChecklistItem[]
  rejectionReason?: string
  improvementInstruction?: string
}

export interface HumanReview {
  decision: 'approved' | 'rejected'
  reason?: string
  reviewedAt: number
}

export type PipelineAiStep = 'brief' | 'refine' | 'ai_review'

export interface PipelineStepProfileConfig {
  brief?: string
  refine?: string
  ai_review?: string
}

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high'

/** Per-step prompt + agent-behaviour overrides for a Content Studio pipeline step. */
export interface PipelineStepSettings {
  /**
   * Override the default prompt template for this step. Empty/undefined → the
   * shipped default is used. May contain `{{placeholder}}` tokens that are
   * interpolated with the step's runtime context (see PipelinePromptDefaults).
   */
  promptTemplate?: string
  /** Model id override for this step (falls back to the profile's model). */
  model?: string
  /** Reasoning-effort override for this step. */
  reasoningEffort?: ReasoningEffort
  /** Sampling temperature (best-effort: only applied by agents that support it). */
  temperature?: number
  /** How many times to auto-retry malformed/truncated JSON before failing. */
  maxJsonAttempts?: number
}

/** Per-project Content Studio pipeline settings (prompts + parameters per step). */
export interface PipelineSettings {
  projectId: string
  steps: Partial<Record<PipelineAiStep, PipelineStepSettings>>
  updatedAt: number
}

/** The shipped default prompt templates, surfaced so the UI can show/reset them. */
export interface PipelinePromptDefaults {
  brief: string
  refine: string
  ai_review: string
}

export interface PipelineAgentProgress {
  /** Pipeline step this progress update belongs to (extract, breakdown, refine, ai_review, etc.). */
  step: string
  /** Overall state of the step's agent run. */
  status: 'running' | 'done' | 'error'
  /** Human-readable description of what the agent is doing right now. */
  message: string
  /** ISO timestamp when the step started. */
  startedAt: string
  /** ISO timestamp of the most recent progress update. */
  updatedAt: string
}

export interface ContentPipeline {
  contentId: string
  rawIdea?: RawIdea
  improvedBrief?: ImprovedBrief
  refinedContent?: RefinedContent
  aiReview?: AiReview
  humanReview?: HumanReview
  draftOutput?: DraftOutput
  transcript?: string
  transcriptSource?: string
  autoIterationCount: number
  updatedAt: number
  stepProfiles?: PipelineStepProfileConfig
  /** Live progress of the currently-running AI agent step. */
  agentProgress?: PipelineAgentProgress
}

/** Pipeline steps that produce a persisted output snapshot. */
export type PipelineStep = 'extract' | 'breakdown' | 'refine' | 'ai_review' | 'human_review'

/**
 * An append-only snapshot of a single step's output for one iteration.
 *
 * The {@link ContentPipeline} row keeps only the latest value per step; this
 * preserves every prior attempt (e.g. a brief that was later rejected and
 * regenerated) so the full creation history stays accessible at runtime.
 */
export interface PipelineHistoryEntry {
  id: string
  contentId: string
  /** 0-based auto-loop iteration this snapshot belongs to. */
  iteration: number
  step: PipelineStep
  /** The step's output (RawIdea, ImprovedBrief, RefinedContent, AiReview, HumanReview). */
  data: unknown
  /** Profile id whose agent produced this output (absent for deterministic/human steps). */
  profileId?: string
  /** Agent kind that produced this output (absent for deterministic/human steps). */
  agent?: AgentKind
  createdAt: number
}

/* ============================================================
   Content generation (Phase 2: generating → draft)
   ============================================================ */

export type GenerationCapability = 'text' | 'image' | 'video' | 'audio' | 'voiceover'

export type GenerationTaskType =
  | 'final_caption'
  | 'final_hashtags'
  | 'text_overlay'
  | 'image'
  | 'carousel'
  | 'video'
  | 'audio'
  | 'voiceover'

export type GenerationTaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'manual'

export interface GenerationOutput {
  text?: string
  assetPaths?: string[]
  meta?: Record<string, unknown>
}

export interface GenerationTask {
  id: string
  contentId: string
  projectId: string
  type: GenerationTaskType
  capability: GenerationCapability
  generator: string
  inputPrompt: string
  status: GenerationTaskStatus
  output?: GenerationOutput
  error?: string
  retryCount: number
  createdAt: number
  updatedAt: number
}

export interface DraftOutput {
  finalCaption: string
  finalHashtags: string[]
  assets: Array<{ type: GenerationTaskType; paths: string[]; meta?: Record<string, unknown> }>
  copywriting?: Copywriting
  platformNotes?: string
  sourceRef: { candidateId?: string; referenceUrl?: string; referencePostId?: string }
  generationMeta: Array<{ taskId: string; type: GenerationTaskType; generator: string; status: GenerationTaskStatus }>
  reviewHistory: { aiReview?: AiReview; humanReview?: HumanReview }
  lessonsUsed: string[]
  generationLogs: Array<{ taskId: string; type: GenerationTaskType; status: GenerationTaskStatus; error?: string }>
  stitchedAt: number
}

export interface TaskSummary {
  id: string
  projectId?: string
  title: string
  description?: string
  status: TaskStatus
  priority: TaskPriority
  assigneeProfileId?: string
  fileReferences: string[]
  workflowReferences: string[]
  createdAt: number
  updatedAt: number
}

export interface CreateTaskInput {
  projectId?: string
  title: string
  description?: string
  status?: TaskStatus
  priority?: TaskPriority
  assigneeProfileId?: string
  fileReferences?: string[]
  workflowReferences?: string[]
}

export interface UpdateTaskInput {
  title?: string
  description?: string | null
  status?: TaskStatus
  priority?: TaskPriority
  assigneeProfileId?: string | null
  fileReferences?: string[]
  workflowReferences?: string[]
}

export type TaskListResponse = ListResponse<TaskSummary>

export interface CaptureResultPayload {
  ok: true
  competitor: CompetitorSummary
  capturedCount: number
  warnings: string[]
}

/* ============================================================
   Background jobs
   ============================================================
   Generic in-app job model. The backend runs long-running work
   (competitor discovery, post capture, and — later — workspace
   extraction) as detached jobs and surfaces their state through
   `GET /jobs`, `GET /jobs/:id`, and an SSE feed at `GET /jobs/stream`.

   The model is intentionally generic over `kind` and carries an
   opaque `result` so new job kinds can reuse the same registry,
   top-nav progress bar, and completion alerts without backend or
   UI changes beyond a new `kind` string + result shape.
   ============================================================ */

export type JobState =
  | 'queued'
  | 'running'
  /** A stop was requested; the job is winding down the in-flight unit of work. */
  | 'stopping'
  /** The job was cancelled by the user. Partial results are preserved. */
  | 'stopped'
  | 'succeeded'
  | 'failed'

/** Known job kinds. Add new strings here as more background work is introduced. */
export type JobKind =
  | 'discover-competitors'
  | 'capture-posts'
  | 'capture-posts-batch'
  | 'extract-workspace'
  | (string & {})

/**
 * Fine-grained sub-phase for chunked jobs, surfaced inside `JobProgress`.
 * Distinct from the lifecycle `JobState`: a job can be `running` while its
 * progress `status` is `delaying-between-chunks` (the inter-chunk cooldown).
 */
export type JobProgressStatus = 'capturing' | 'delaying-between-chunks'

export interface JobProgress {
  /** Crawler phase, e.g. "discover" or "capture". */
  phase?: string
  /** Items processed so far (when known). */
  current?: number
  /** Target item count (when known). */
  total?: number
  /** Latest human-readable note. */
  note?: string
  /** Sub-phase for chunked batch jobs (capturing vs. cooling down). */
  status?: JobProgressStatus
  /** 1-based index of the chunk currently being processed. */
  chunkIndex?: number
  /** Total number of chunks the batch was split into. */
  totalChunks?: number
  /** Profiles fully captured so far across all chunks. */
  profilesCompleted?: number
  /** Total profiles queued for the batch. */
  totalProfiles?: number
  /** Handle of the profile currently being captured (if any). */
  currentHandle?: string
  /** Seconds left on the inter-chunk cooldown (only during `delaying-between-chunks`). */
  delaySecondsRemaining?: number
}

export interface JobSummary<TResult = unknown> {
  id: string
  kind: JobKind
  /** Short human label for the top-nav progress bar, e.g. "Discover · #productivity". */
  label: string
  state: JobState
  progress: JobProgress
  /** Present once the job has succeeded. Shape depends on `kind`. */
  result?: TResult
  /** Present once the job has failed. */
  error?: string
  /** Non-fatal warnings collected during the run. */
  warnings: string[]
  /** Optional project scoping so the UI can filter by active project. */
  projectId?: string
  createdAt: number
  startedAt?: number
  finishedAt?: number
}

export type JobListResponse = ListResponse<JobSummary>

/** Result payload for a `discover-competitors` job. */
export interface DiscoverJobResult {
  candidates: DiscoveredCandidate[]
}

/** Result payload for a `capture-posts` job. */
export interface CaptureJobResult {
  competitor: CompetitorSummary
  capturedCount: number
}

/* -----------------------------------------------------------
   Batch-capture tuning constants
   -----------------------------------------------------------
   Single source of truth for the chunked-capture pacing, shared
   by the backend orchestrator and the frontend hints. Tune here.
   ----------------------------------------------------------- */

/** Max profiles captured per chunk before a cooldown delay. */
export const CAPTURE_CHUNK_SIZE = 8
/** Inter-chunk cooldown lower bound (20 seconds). Chunks now capture in
 *  parallel bursts, so the cooldown is the only pacing between bursts. */
export const CAPTURE_CHUNK_DELAY_MIN_MS = 20_000
/** Inter-chunk cooldown upper bound (40 seconds). */
export const CAPTURE_CHUNK_DELAY_MAX_MS = 40_000

/** Per-competitor outcome inside a batch capture run. */
export interface BatchCaptureOutcome {
  handle: string
  /** Candidate posts surfaced for this competitor (not yet saved). */
  candidateCount: number
  ok: boolean
  error?: string
}

/** Result payload for a `capture-posts-batch` job. */
export interface BatchCaptureJobResult {
  /** Profiles queued for the batch. */
  totalProfiles: number
  /** Profiles actually processed (may be < total if the run was stopped). */
  profilesCompleted: number
  /** Total candidate posts surfaced across every processed profile. */
  candidateCount: number
  /** True when the run ended early due to a user stop. */
  stopped: boolean
  /** Per-competitor breakdown, in processing order. */
  perCompetitor: BatchCaptureOutcome[]
}

/** Result payload for an `extract-workspace` job. */
export interface ExtractWorkspaceJobResult {
  /** Total candidate files discovered (after `.anubisignore` filtering). */
  totalCount: number
  /** Files processed without error. */
  processedCount: number
  /** Files that returned from the extractor's sidecar cache (skipped re-extraction). */
  cachedCount: number
  /** Files that failed extraction (counted, with messages added to job warnings). */
  failedCount: number
  /** How many image files were OCR'd. */
  imageCount: number
  /** How many audio/video files were transcribed. */
  mediaCount: number
}

export interface CapturePreviewPayload {
  ok: true
  competitor: CompetitorSummary
  posts: CapturedPostSummary[]
  candidateCount: number
  warnings: string[]
}

export interface ImportCapturedPostsInput {
  posts: Array<{
    id?: string
    competitorId: string
    username: string
    postUrl: string
    caption?: string
    likes?: number
    comments?: number
    postedAt?: string
    mediaKind?: 'image' | 'video' | 'carousel'
    mediaUrl?: string
    carouselCount?: number
    capturedAt?: number
    raw?: Record<string, unknown>
  }>
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

/* ============================================================
   Wire-shape error codes
   ============================================================
   Single source of truth for the `error.code` strings the backend
   emits and the frontend parses. The Node-side packages can't be
   imported by the renderer (they pull in better-sqlite3 etc.), so
   both ends point at this constant instead of re-typing the literal.
   ============================================================ */

export const NO_CREDENTIALS_ERROR_CODE = 'no_credentials' as const
export const AGENT_NOT_INSTALLED_ERROR_CODE = 'agent_not_installed' as const

export interface NoCredentialsErrorPayload {
  code: typeof NO_CREDENTIALS_ERROR_CODE
  profileId: string
  agent: AgentKind
}

export interface AgentNotInstalledErrorPayload {
  code: typeof AGENT_NOT_INSTALLED_ERROR_CODE
  agent: AgentKind
  message?: string
}

/* ============================================================
   Project snapshot — import/export of competitors + captured
   posts for moving a project's data between installs. See
   docs/superpowers/specs/2026-06-11-import-export-snapshot-design.md
   ============================================================ */

export interface SnapshotProjectInfo {
  id: string
  name: string
  emoji?: string
  color?: string
  description?: string
}

export interface SnapshotCompetitor {
  handle: string
  displayName?: string
  niche?: string
  tint?: string
  followers?: number
  avgLikes?: number
  postCount?: number
  lastRefreshedAt?: number
  notes?: string
  bio?: string
  level?: CompetitorLevelOverride
  addedAt?: number
  updatedAt?: number
}

export interface SnapshotCapturedPost {
  competitorHandle: string
  username: string
  postUrl: string
  caption?: string
  likes?: number
  comments?: number
  postedAt?: string
  mediaKind?: 'image' | 'video' | 'carousel'
  mediaUrl?: string
  carouselCount?: number
  capturedAt?: number
  raw?: Record<string, unknown>
}

export interface ProjectSnapshot {
  kind: 'anubis-project-snapshot'
  schemaVersion: 1
  exportedAt: number
  app: { name: string; version: string }
  project: SnapshotProjectInfo
  competitors: SnapshotCompetitor[]
  capturedPosts: SnapshotCapturedPost[]
}

export interface ImportSnapshotInput {
  projectId?: string
  snapshot: ProjectSnapshot
}

export interface ImportSnapshotResult {
  ok: true
  projectId: string
  competitors: { created: number; matched: number }
  posts: { imported: number; skipped: number }
  warnings: string[]
}

/* ============================================================
   Research Phase — sessions & candidates
   ============================================================ */

export interface ResearchControls {
  competitorIds?: string[]
  favoriteOnly?: boolean
  platform?: string
  niche?: string
  dateFrom?: string            // ISO; inclusive lower bound on postedAt
  dateTo?: string              // ISO; inclusive upper bound on postedAt
  maxPostsPerProfile?: number  // default 20 (also the baseline sample window)
  maxContentAgeDays?: number   // default 7
}

export type ResearchSessionStatus = 'scoring' | 'validating' | 'done' | 'error'

export interface ResearchSessionCounts {
  candidates: number
  valid: number
  green: number
  yellow: number
  neutral: number
}

export interface ResearchSessionSummary {
  id: string
  projectId?: string
  controls: ResearchControls
  status: ResearchSessionStatus
  counts: ResearchSessionCounts
  error?: string
  createdAt: number
  updatedAt: number
}

export type CandidateDecision = 'none' | 'selected' | 'rejected' | 'saved'

export interface ResearchCandidateSummary {
  id: string
  projectId?: string
  sessionId: string
  competitorId: string
  competitorHandle?: string
  competitorLevel: CompetitorLevel
  postId: string
  platform?: string
  postUrl?: string
  postedAt?: string
  caption?: string
  mediaKind?: 'image' | 'video' | 'carousel'
  likes?: number
  baselineLikes?: number
  score?: number
  candidateLevel: CandidateLevel
  nicheAligned?: boolean
  nicheReason?: string
  validationStatus: CandidateValidationStatus
  validationFailures: CandidateValidationRule[]
  decision: CandidateDecision
  createdAt: number
  updatedAt: number
}

export interface CreateResearchSessionInput {
  projectId?: string
  controls?: ResearchControls
}

export interface UpdateResearchCandidateInput {
  decision?: CandidateDecision
  nicheAligned?: boolean | null
  nicheReason?: string | null
}

export type ResearchSessionListResponse = ListResponse<ResearchSessionSummary>
export type ResearchCandidateListResponse = ListResponse<ResearchCandidateSummary>

export type ResearchDocumentStatus = 'draft' | 'final' | 'archived'

export interface ResearchDocumentSummary {
  id: string
  projectId: string
  title: string
  status: ResearchDocumentStatus
  tags: string[]
  candidateIds: string[]
  competitorIds: string[]
  postIds: string[]
  sourceUrls: string[]
  summary?: string
  findings?: string
  evidence?: string
  createdAt: number
  updatedAt: number
}

export type ResearchDocumentListResponse = ListResponse<ResearchDocumentSummary>
