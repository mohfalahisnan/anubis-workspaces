import type {
  CandidateLevel,
  CandidateValidationRule,
  CandidateValidationStatus,
  CompetitorSummary,
  ResearchCandidateSummary,
} from '@anubis/shared'

/** Tier colors for the candidate level (distinct from competitor level). */
export const CANDIDATE_LEVEL_COLOR: Record<CandidateLevel, string> = {
  green: '#5E8F55',
  yellow: '#C9A645',
  neutral: '#6B6F78',
}

export const CANDIDATE_LEVEL_LABEL: Record<CandidateLevel, string> = {
  green: 'High priority',
  yellow: 'Good signal',
  neutral: 'Weak signal',
}

export const VALIDATION_LABEL: Record<CandidateValidationStatus, string> = {
  valid: 'Valid',
  invalid: 'Invalid',
  pending: 'Pending',
}

const VALIDATION_RULE_LABEL: Record<CandidateValidationRule, string> = {
  recency: 'Too old (beyond max content age)',
  niche: 'Off-niche',
  score: 'No valid score / baseline',
  source: 'Invalid competitor source',
}

export interface LibrarySummary {
  total: number
  favorites: number
  byPlatform: Record<string, number>
  byNiche: Record<string, number>
  byStatus: Record<string, number>
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1
}

export function summarizeLibrary(competitors: CompetitorSummary[]): LibrarySummary {
  const summary: LibrarySummary = { total: 0, favorites: 0, byPlatform: {}, byNiche: {}, byStatus: {} }
  for (const c of competitors) {
    summary.total += 1
    if (c.favorite) summary.favorites += 1
    bump(summary.byPlatform, c.platform ?? 'instagram')
    bump(summary.byNiche, c.niche?.trim() || 'Uncategorized')
    bump(summary.byStatus, c.status ?? 'active')
  }
  return summary
}

/** A multiplier score as "20.0×", or an em dash when missing/non-finite. */
export function formatScore(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score)) return '—'
  return `${score.toFixed(1)}×`
}

/* ---------- date filtering ----------
   The Research page filters the already-loaded candidates by their `postedAt`
   client-side, alongside the validation/level filters. Presets are relative
   day windows; `custom` uses inclusive local-day from/to bounds. */

export type DatePreset = 'all' | '7d' | '30d' | '90d' | 'custom'

export interface DateFilterState {
  preset: DatePreset
  /** yyyy-mm-dd, inclusive lower bound (custom preset only). */
  from?: string
  /** yyyy-mm-dd, inclusive upper bound (custom preset only). */
  to?: string
}

export const DEFAULT_DATE_FILTER: DateFilterState = { preset: 'all' }

const PRESET_DAYS: Record<'7d' | '30d' | '90d', number> = { '7d': 7, '30d': 30, '90d': 90 }
const DAY_MS = 86_400_000

/** Resolve a filter state to inclusive epoch-ms bounds; `null` means open-ended. */
export function resolveDateBounds(
  state: DateFilterState,
  now: number,
): { fromMs: number | null; toMs: number | null } {
  if (state.preset === 'all') return { fromMs: null, toMs: null }
  if (state.preset === 'custom') {
    const from = state.from ? new Date(`${state.from}T00:00:00`).getTime() : NaN
    const to = state.to ? new Date(`${state.to}T23:59:59.999`).getTime() : NaN
    return {
      fromMs: Number.isFinite(from) ? from : null,
      toMs: Number.isFinite(to) ? to : null,
    }
  }
  return { fromMs: now - PRESET_DAYS[state.preset] * DAY_MS, toMs: null }
}

/** Keep candidates whose `postedAt` falls within the filter's bounds. With no
 *  bound active every candidate is kept; with a bound active, candidates whose
 *  `postedAt` is missing or unparseable are dropped. */
export function filterCandidatesByDate(
  candidates: ResearchCandidateSummary[],
  state: DateFilterState,
  now: number,
): ResearchCandidateSummary[] {
  const { fromMs, toMs } = resolveDateBounds(state, now)
  if (fromMs === null && toMs === null) return candidates
  return candidates.filter((c) => {
    const t = c.postedAt ? Date.parse(c.postedAt) : NaN
    if (!Number.isFinite(t)) return false
    if (fromMs !== null && t < fromMs) return false
    if (toMs !== null && t > toMs) return false
    return true
  })
}

/** Human-readable explanation of a candidate's validation outcome. */
export function candidateValidationReason(candidate: ResearchCandidateSummary): string {
  if (candidate.validationStatus === 'valid') {
    return 'Passes recency, score, source, and niche alignment.'
  }
  if (candidate.validationStatus === 'pending') {
    return 'Awaiting a niche-alignment decision.'
  }
  if (candidate.validationFailures.length === 0) return 'Invalid.'
  return candidate.validationFailures.map((f) => VALIDATION_RULE_LABEL[f] ?? f).join('; ')
}
