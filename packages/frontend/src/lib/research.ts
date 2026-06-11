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
