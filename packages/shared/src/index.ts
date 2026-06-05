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
  bio?: string
  level?: CompetitorLevelOverride
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
  bio?: string
  level?: CompetitorLevelOverride
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
  yellowMax: 100_000,
  maxActive: 1_000_000,
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
  /** Owning competitor's follower count, joined in by the route layer. */
  competitorFollowers?: number
  /** Owning competitor's avgLikes, joined in by the route layer. */
  competitorAvgLikes?: number
  /** Owning competitor's manual level override, joined in by the route layer. */
  competitorLevel?: CompetitorLevelOverride
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
