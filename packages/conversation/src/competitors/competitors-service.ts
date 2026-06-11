import type { CompetitorLevelOverride } from '@anubis/shared'
import { newId } from '../util/ids.js'
import { nowMs } from '../util/time.js'
import type { Competitor, CompetitorsRepo } from '../db/repositories/competitors-repo.js'

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
  status?: 'active' | 'paused' | 'archived'
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
  status?: 'active' | 'paused' | 'archived'
  favorite?: boolean
}

/**
 * Curated list of accent tints used when no explicit colour is given.
 * Pulled from the brand palette + a few warm/cool variants so cards
 * stay visually distinct without veering off-brand.
 */
const DEFAULT_TINTS = [
  '#B5663F', // warm amber
  '#4E6E8E', // dusty blue
  '#5E7D55', // sage
  '#7E5E92', // muted plum
  '#A85F6B', // rose
  '#565B63', // graphite
  '#9C6A3F', // ochre
  '#3F8079', // teal
  '#46617E', // slate blue
] as const

function normaliseHandle(raw: string): string {
  const trimmed = raw.trim().toLowerCase()
  if (trimmed.length === 0) throw new Error('Handle is required')
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`
}

function handleKey(handle: string): string {
  return normaliseHandle(handle)
}

function pickTintFor(handle: string): string {
  let hash = 0
  for (let i = 0; i < handle.length; i++) hash = (hash * 31 + handle.charCodeAt(i)) >>> 0
  return DEFAULT_TINTS[hash % DEFAULT_TINTS.length]!
}

export class CompetitorsService {
  constructor(private repo: CompetitorsRepo) {}

  list(projectId?: string): Competitor[] {
    const seen = new Set<string>()
    const out: Competitor[] = []
    for (const competitor of this.repo.list(projectId)) {
      const key = handleKey(competitor.handle)
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ ...competitor, handle: key })
    }
    return out
  }

  get(id: string): Competitor | null {
    return this.repo.findById(id)
  }

  create(input: CreateCompetitorInput): Competitor {
    const handle = normaliseHandle(input.handle)
    if (this.repo.findByHandle(handle)) {
      throw new Error(`Already tracking ${handle}`)
    }
    const now = nowMs()
    const competitor: Competitor = {
      id: newId(),
      handle,
      projectId: input.projectId,
      displayName: input.displayName?.trim() || undefined,
      niche: input.niche?.trim() || undefined,
      tint: input.tint ?? pickTintFor(handle),
      followers: input.followers,
      avgLikes: input.avgLikes,
      postCount: 0,
      notes: input.notes?.trim() || undefined,
      bio: input.bio?.trim() || undefined,
      level: input.level ?? undefined,
      platform: input.platform ?? 'instagram',
      status: input.status ?? 'active',
      favorite: input.favorite ?? false,
      addedAt: now,
      updatedAt: now,
    }
    this.repo.insert(competitor)
    return competitor
  }

  update(id: string, patch: UpdateCompetitorInput): Competitor {
    const existing = this.repo.findById(id)
    if (!existing) throw new Error(`Competitor not found: ${id}`)
    const next = this.repo.update(id, {
      displayName: patch.displayName ?? existing.displayName,
      niche: patch.niche ?? existing.niche,
      tint: patch.tint ?? existing.tint,
      followers: patch.followers ?? existing.followers,
      avgLikes: patch.avgLikes ?? existing.avgLikes,
      postCount: patch.postCount ?? existing.postCount,
      notes: patch.notes ?? existing.notes,
      bio: patch.bio ?? existing.bio,
      level: 'level' in patch ? (patch.level ?? undefined) : existing.level,
      platform: patch.platform ?? existing.platform,
      status: patch.status ?? existing.status,
      favorite: patch.favorite ?? existing.favorite,
    })
    return next!
  }

  remove(id: string): void {
    this.repo.softDelete(id)
  }

  /**
   * Records the timestamp of a successful capture. Used by the
   * backend's capture orchestrator and intentionally not part of
   * the open `update()` surface so refresh state can't be faked
   * by clients.
   */
  markRefreshedAt(id: string, atMs: number): void {
    this.repo.update(id, { lastRefreshedAt: atMs })
  }

  /**
   * Persist a recomputed performance baseline. Owned by the Research flow and
   * kept off the open update() surface so it can't be spoofed by clients.
   */
  setBaseline(
    id: string,
    baseline: { baselineLikes: number | null; baselineSampleSize: number; baselineUpdatedAt: number },
  ): void {
    this.repo.update(id, {
      baselineLikes: baseline.baselineLikes ?? undefined,
      baselineSampleSize: baseline.baselineSampleSize,
      baselineUpdatedAt: baseline.baselineUpdatedAt,
    })
  }
}

export type { Competitor }
