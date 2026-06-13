import {
  effectiveLevel,
  evaluateCandidateValidation,
  getCandidateLevel,
  medianLikes,
  scoreFor,
  type CandidateValidationResult,
  type CreateResearchSessionInput,
  type ResearchControls,
  type ResearchSessionCounts,
} from '@anubis/shared'
import { newId } from '../util/ids.js'
import { nowMs } from '../util/time.js'
import type { CompetitorsService } from '../competitors/competitors-service.js'
import type { Competitor } from '../db/repositories/competitors-repo.js'
import type { CapturedPostsRepo } from '../db/repositories/captured-posts-repo.js'
import { ResearchSessionsRepo, type ResearchSession } from '../db/repositories/research-sessions-repo.js'
import { ResearchCandidatesRepo, type ResearchCandidate, type ListCandidatesOpts } from '../db/repositories/research-candidates-repo.js'

const DEFAULT_MAX_POSTS = 20
const DEFAULT_MAX_AGE_DAYS = 7

export interface ResearchServiceDeps {
  competitors: CompetitorsService
  capturedPosts: CapturedPostsRepo
  sessions: ResearchSessionsRepo
  candidates: ResearchCandidatesRepo
}

export interface CreateSessionResult {
  session: ResearchSession
  candidates: ResearchCandidate[]
}

export class ResearchService {
  constructor(private deps: ResearchServiceDeps) {}

  async createSession(input: CreateResearchSessionInput): Promise<CreateSessionResult> {
    const projectId = input.projectId ?? 'default'
    const controls: ResearchControls = input.controls ?? {}
    const maxPosts = controls.maxPostsPerProfile ?? DEFAULT_MAX_POSTS
    const maxAgeDays = controls.maxContentAgeDays ?? DEFAULT_MAX_AGE_DAYS
    const now = nowMs()

    const session: ResearchSession = {
      id: newId(),
      projectId,
      controls,
      status: 'scoring',
      createdAt: now,
      updatedAt: now,
    }
    this.deps.sessions.insert(session)

    const eligible = this.selectCompetitors(projectId, controls)
    const built: ResearchCandidate[] = []

    for (const competitor of eligible) {
      const pool = this.deps.capturedPosts.list({
        competitorId: competitor.id,
        projectId,
        orderBy: 'recent',
        limit: maxPosts,
      })
      if (pool.length === 0) continue

      const baseline = medianLikes(pool.map((p) => p.likes ?? NaN))
      this.deps.competitors.setBaseline(competitor.id, {
        baselineLikes: baseline,
        baselineSampleSize: pool.length,
        baselineUpdatedAt: now,
      })

      const compLevel = effectiveLevel(competitor.level, competitor.followers)
      const competitorActive = competitor.status !== 'archived'

      for (const post of pool) {
        if (!withinDateRange(post.postedAt, controls)) continue
        const score = scoreFor(post.likes, baseline)
        const candidateLevel = score == null ? 'neutral' : getCandidateLevel(score, compLevel)
        const validation: CandidateValidationResult = evaluateCandidateValidation({
          postedAt: post.postedAt,
          baselineLikes: baseline,
          score,
          competitorActive,
          nicheAligned: null, // Phase A: manual niche, unresolved at build time
          maxContentAgeDays: maxAgeDays,
          nowMs: now,
        })
        built.push({
          id: newId(),
          projectId,
          sessionId: session.id,
          competitorId: competitor.id,
          postId: post.id,
          platform: competitor.platform,
          postUrl: post.postUrl,
          postedAt: post.postedAt,
          caption: post.caption,
          mediaKind: post.mediaKind,
          likes: post.likes,
          baselineLikes: baseline ?? undefined,
          score: score ?? undefined,
          competitorLevel: compLevel,
          candidateLevel,
          nicheAligned: null,
          validationStatus: validation.status,
          validationFailures: validation.failures,
          decision: 'none',
          createdAt: now,
          updatedAt: now,
        })
      }
    }

    this.deps.candidates.insertMany(built)
    const counts = countCandidates(built)
    const updated = this.deps.sessions.update(session.id, { status: 'done', counts })!
    return { session: updated, candidates: built }
  }

  listSessions(projectId?: string): ResearchSession[] {
    return this.deps.sessions.list(projectId)
  }

  getSession(id: string): ResearchSession | null {
    return this.deps.sessions.findById(id)
  }

  listCandidates(opts: ListCandidatesOpts): ResearchCandidate[] {
    return this.deps.candidates.list(opts)
  }

  getCandidate(id: string): ResearchCandidate | null {
    return this.deps.candidates.findById(id)
  }

  /** Update a candidate's decision and/or niche verdict; re-evaluate validation. */
  updateCandidate(
    id: string,
    patch: { decision?: ResearchCandidate['decision']; nicheAligned?: boolean | null; nicheReason?: string | null },
  ): ResearchCandidate | null {
    const cur = this.deps.candidates.findById(id)
    if (!cur) return null
    const session = this.deps.sessions.findById(cur.sessionId)
    const competitor = this.deps.competitors.get(cur.competitorId)
    const maxAgeDays = session?.controls.maxContentAgeDays ?? DEFAULT_MAX_AGE_DAYS

    const nicheAligned =
      patch.nicheAligned === undefined ? cur.nicheAligned : patch.nicheAligned
    const validation = evaluateCandidateValidation({
      postedAt: cur.postedAt,
      baselineLikes: cur.baselineLikes,
      score: cur.score,
      competitorActive: (competitor?.status ?? 'archived') !== 'archived',
      nicheAligned,
      maxContentAgeDays: maxAgeDays,
      nowMs: nowMs(),
    })

    return this.deps.candidates.update(id, {
      decision: patch.decision ?? cur.decision,
      nicheAligned,
      nicheReason: patch.nicheReason === undefined ? cur.nicheReason : (patch.nicheReason ?? undefined),
      validationStatus: validation.status,
      validationFailures: validation.failures,
    })
  }

  private selectCompetitors(projectId: string, controls: ResearchControls): Competitor[] {
    let list = this.deps.competitors.list(projectId)
    if (controls.competitorIds && controls.competitorIds.length > 0) {
      const wanted = new Set(controls.competitorIds)
      list = list.filter((c) => wanted.has(c.id))
    }
    if (controls.favoriteOnly) list = list.filter((c) => c.favorite)
    if (controls.platform) list = list.filter((c) => c.platform === controls.platform)
    if (controls.niche) list = list.filter((c) => c.niche === controls.niche)
    return list
  }
}

function withinDateRange(postedAt: string | undefined, controls: ResearchControls): boolean {
  if (!controls.dateFrom && !controls.dateTo) return true
  if (!postedAt) return false
  const t = Date.parse(postedAt)
  if (!Number.isFinite(t)) return false
  if (controls.dateFrom && t < Date.parse(controls.dateFrom)) return false
  if (controls.dateTo && t > Date.parse(controls.dateTo)) return false
  return true
}

function countCandidates(candidates: ResearchCandidate[]): ResearchSessionCounts {
  return {
    candidates: candidates.length,
    valid: candidates.filter((c) => c.validationStatus === 'valid').length,
    green: candidates.filter((c) => c.candidateLevel === 'green').length,
    yellow: candidates.filter((c) => c.candidateLevel === 'yellow').length,
    neutral: candidates.filter((c) => c.candidateLevel === 'neutral').length,
  }
}
