import { newId } from '../util/ids.js'
import { nowMs } from '../util/time.js'
import type { Competitor, CompetitorsRepo } from '../db/repositories/competitors-repo.js'

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
  const trimmed = raw.trim()
  if (trimmed.length === 0) throw new Error('Handle is required')
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`
}

function pickTintFor(handle: string): string {
  let hash = 0
  for (let i = 0; i < handle.length; i++) hash = (hash * 31 + handle.charCodeAt(i)) >>> 0
  return DEFAULT_TINTS[hash % DEFAULT_TINTS.length]!
}

export class CompetitorsService {
  constructor(private repo: CompetitorsRepo) {}

  list(): Competitor[] {
    return this.repo.list()
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
      displayName: input.displayName?.trim() || undefined,
      niche: input.niche?.trim() || undefined,
      tint: input.tint ?? pickTintFor(handle),
      followers: input.followers,
      avgLikes: input.avgLikes,
      postCount: 0,
      notes: input.notes?.trim() || undefined,
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
    })
    return next!
  }

  remove(id: string): void {
    this.repo.softDelete(id)
  }
}

export type { Competitor }
