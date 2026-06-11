import type {
  CandidateDecision,
  CandidateLevel,
  CandidateValidationRule,
  CandidateValidationStatus,
  CompetitorLevel,
} from '@anubis/shared'
import type { Db } from '../client.js'

export interface ResearchCandidate {
  id: string
  projectId?: string
  sessionId: string
  competitorId: string
  postId: string
  platform?: string
  postUrl?: string
  postedAt?: string
  caption?: string
  mediaKind?: 'image' | 'video' | 'carousel'
  likes?: number
  baselineLikes?: number
  score?: number
  competitorLevel: CompetitorLevel
  candidateLevel: CandidateLevel
  nicheAligned?: boolean | null
  nicheReason?: string
  validationStatus: CandidateValidationStatus
  validationFailures: CandidateValidationRule[]
  decision: CandidateDecision
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

export interface ListCandidatesOpts {
  sessionId?: string
  projectId?: string
  validationStatus?: CandidateValidationStatus
  candidateLevel?: CandidateLevel
  decision?: CandidateDecision
}

interface Row {
  id: string
  project_id: string | null
  session_id: string
  competitor_id: string
  post_id: string
  platform: string | null
  post_url: string | null
  posted_at: string | null
  caption: string | null
  media_kind: string | null
  likes: number | null
  baseline_likes: number | null
  score: number | null
  competitor_level: string | null
  candidate_level: string | null
  niche_aligned: number | null
  niche_reason: string | null
  validation_status: string
  validation_failures: string | null
  decision: string
  created_at: number
  updated_at: number
  deleted_at: number | null
}

function toCandidate(r: Row): ResearchCandidate {
  return {
    id: r.id,
    projectId: r.project_id ?? undefined,
    sessionId: r.session_id,
    competitorId: r.competitor_id,
    postId: r.post_id,
    platform: r.platform ?? undefined,
    postUrl: r.post_url ?? undefined,
    postedAt: r.posted_at ?? undefined,
    caption: r.caption ?? undefined,
    mediaKind: (r.media_kind as ResearchCandidate['mediaKind']) ?? undefined,
    likes: r.likes ?? undefined,
    baselineLikes: r.baseline_likes ?? undefined,
    score: r.score ?? undefined,
    competitorLevel: (r.competitor_level as CompetitorLevel) ?? 'unknown',
    candidateLevel: (r.candidate_level as CandidateLevel) ?? 'neutral',
    nicheAligned: r.niche_aligned == null ? null : r.niche_aligned === 1,
    nicheReason: r.niche_reason ?? undefined,
    validationStatus: r.validation_status as CandidateValidationStatus,
    validationFailures: r.validation_failures
      ? (JSON.parse(r.validation_failures) as CandidateValidationRule[])
      : [],
    decision: r.decision as CandidateDecision,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? undefined,
  }
}

export class ResearchCandidatesRepo {
  constructor(private db: Db) {}

  insertMany(candidates: ResearchCandidate[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO research_candidates (
        id, project_id, session_id, competitor_id, post_id, platform, post_url, posted_at,
        caption, media_kind, likes, baseline_likes, score, competitor_level, candidate_level,
        niche_aligned, niche_reason, validation_status, validation_failures, decision,
        created_at, updated_at, deleted_at
      ) VALUES (
        @id, @projectId, @sessionId, @competitorId, @postId, @platform, @postUrl, @postedAt,
        @caption, @mediaKind, @likes, @baselineLikes, @score, @competitorLevel, @candidateLevel,
        @nicheAligned, @nicheReason, @validationStatus, @validationFailures, @decision,
        @createdAt, @updatedAt, @deletedAt
      )
    `)
    const tx = this.db.transaction((items: ResearchCandidate[]) => {
      for (const c of items) {
        stmt.run({
          id: c.id,
          projectId: c.projectId ?? 'default',
          sessionId: c.sessionId,
          competitorId: c.competitorId,
          postId: c.postId,
          platform: c.platform ?? null,
          postUrl: c.postUrl ?? null,
          postedAt: c.postedAt ?? null,
          caption: c.caption ?? null,
          mediaKind: c.mediaKind ?? null,
          likes: c.likes ?? null,
          baselineLikes: c.baselineLikes ?? null,
          score: c.score ?? null,
          competitorLevel: c.competitorLevel,
          candidateLevel: c.candidateLevel,
          nicheAligned: c.nicheAligned == null ? null : c.nicheAligned ? 1 : 0,
          nicheReason: c.nicheReason ?? null,
          validationStatus: c.validationStatus,
          validationFailures: JSON.stringify(c.validationFailures),
          decision: c.decision,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          deletedAt: c.deletedAt ?? null,
        })
      }
    })
    tx(candidates)
  }

  findById(id: string): ResearchCandidate | null {
    const r = this.db
      .prepare('SELECT * FROM research_candidates WHERE id = ? AND deleted_at IS NULL')
      .get(id) as Row | undefined
    return r ? toCandidate(r) : null
  }

  list(opts: ListCandidatesOpts = {}): ResearchCandidate[] {
    const where: string[] = ['deleted_at IS NULL']
    const params: unknown[] = []
    if (opts.sessionId) { where.push('session_id = ?'); params.push(opts.sessionId) }
    if (opts.projectId) { where.push('project_id = ?'); params.push(opts.projectId) }
    if (opts.validationStatus) { where.push('validation_status = ?'); params.push(opts.validationStatus) }
    if (opts.candidateLevel) { where.push('candidate_level = ?'); params.push(opts.candidateLevel) }
    if (opts.decision) { where.push('decision = ?'); params.push(opts.decision) }
    const sql = `SELECT * FROM research_candidates WHERE ${where.join(' AND ')} ORDER BY score DESC, created_at DESC`
    const rows = this.db.prepare(sql).all(...params) as Row[]
    return rows.map(toCandidate)
  }

  update(
    id: string,
    patch: Partial<Pick<ResearchCandidate, 'decision' | 'nicheAligned' | 'nicheReason' | 'validationStatus' | 'validationFailures'>>,
  ): ResearchCandidate | null {
    const cur = this.findById(id)
    if (!cur) return null
    const next: ResearchCandidate = { ...cur, ...patch, updatedAt: Date.now() }
    this.db.prepare(`
      UPDATE research_candidates SET
        decision = ?, niche_aligned = ?, niche_reason = ?,
        validation_status = ?, validation_failures = ?, updated_at = ?
      WHERE id = ?
    `).run(
      next.decision,
      next.nicheAligned == null ? null : next.nicheAligned ? 1 : 0,
      next.nicheReason ?? null,
      next.validationStatus,
      JSON.stringify(next.validationFailures),
      next.updatedAt,
      id,
    )
    return next
  }
}
