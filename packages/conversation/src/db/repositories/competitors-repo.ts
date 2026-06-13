import type { CompetitorLevelOverride } from '@anubis/shared'
import { z } from 'zod'
import type { Db } from '../client.js'
import {
  DocumentStoreError,
  parseDocumentData,
  type MarkdownDocument,
  type MarkdownDocumentStore,
} from '../../documents/document-store.js'
import { readSection, writeSections } from '../../documents/markdown-sections.js'

export interface Competitor {
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
  platform: string
  status: 'active' | 'paused' | 'archived'
  favorite: boolean
  baselineLikes?: number
  baselineSampleSize?: number
  baselineUpdatedAt?: number
  addedAt: number
  updatedAt: number
  deletedAt?: number
}

const ROOT = 'knowledge/competitors'
const CompetitorData = z.object({
  id: z.string(),
  project_id: z.string(),
  handle: z.string().min(1),
  display_name: z.string().optional().nullable(),
  niche: z.string().optional().nullable(),
  tint: z.string().optional().nullable(),
  followers: z.number().int().nonnegative().optional().nullable(),
  avg_likes: z.number().int().nonnegative().optional().nullable(),
  level: z.enum(['black', 'green', 'yellow', 'red']).optional().nullable(),
  platform: z.string().default('instagram'),
  status: z.enum(['active', 'paused', 'archived']).default('active'),
  favorite: z.boolean().default(false),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
}).passthrough()

interface RuntimeRow {
  post_count: number
  last_refreshed_at: number | null
  baseline_likes: number | null
  baseline_sample_size: number | null
  baseline_updated_at: number | null
}

export class CompetitorsRepo {
  constructor(
    private readonly db: Db,
    private readonly documents: MarkdownDocumentStore,
  ) {}

  insert(competitor: Competitor): void {
    this.db.prepare(`
      UPDATE competitors SET deleted_at = ?
      WHERE lower(handle) = lower(?) AND id <> ? AND deleted_at IS NULL
    `).run(Date.now(), competitor.handle, competitor.id)
    this.ensureAnchor(competitor)
    try {
      this.write(competitor, null, competitor.updatedAt)
    } catch (error) {
      this.db.prepare('UPDATE competitors SET deleted_at = ? WHERE id = ?').run(Date.now(), competitor.id)
      throw error
    }
  }

  findById(id: string): Competitor | null {
    return this.list().find((competitor) => competitor.id === id) ?? null
  }

  findByHandle(handle: string): Competitor | null {
    const wanted = handle.toLowerCase()
    return this.list().find((competitor) => competitor.handle.toLowerCase() === wanted) ?? null
  }

  list(projectId?: string): Competitor[] {
    const entries = this.documents.list('competitor', ROOT)
      .map((document) => ({ document, competitor: toCompetitor(document) }))
    assertUniqueHandles(entries)
    for (const { competitor } of entries) this.ensureAnchor(competitor)
    return entries
      .map(({ competitor }) => ({ ...competitor, ...this.runtime(competitor.id) }))
      .filter((competitor) => !projectId || competitor.projectId === projectId)
      .sort((a, b) => b.addedAt - a.addedAt)
  }

  update(
    id: string,
    patch: Partial<Omit<Competitor, 'id' | 'handle' | 'addedAt' | 'deletedAt'>>,
  ): Competitor | null {
    const document = this.documents.find('competitor', ROOT, id)
    if (!document) return null
    const current = this.findById(id)!
    const next: Competitor = { ...current, ...patch, updatedAt: Date.now() }
    const authored = Object.keys(patch).some((key) => !RUNTIME_FIELDS.has(key))
    if (authored) this.write(next, document, next.updatedAt)
    this.ensureAnchor(next)
    this.db.prepare(`
      UPDATE competitors SET post_count = ?, last_refreshed_at = ?, baseline_likes = ?,
        baseline_sample_size = ?, baseline_updated_at = ? WHERE id = ?
    `).run(
      next.postCount,
      next.lastRefreshedAt ?? null,
      next.baselineLikes ?? null,
      next.baselineSampleSize ?? null,
      next.baselineUpdatedAt ?? null,
      id,
    )
    return this.findById(id)
  }

  softDelete(id: string): void {
    this.documents.delete('competitor', ROOT, id)
    this.db.prepare('UPDATE competitors SET deleted_at = ? WHERE id = ?').run(Date.now(), id)
  }

  private write(competitor: Competitor, existing: MarkdownDocument | null, now: number): void {
    const body = writeSections(existing?.body ?? '', {
      Bio: competitor.bio,
      Notes: competitor.notes,
    })
    this.documents.write({
      type: 'competitor',
      projectId: competitor.projectId ?? 'default',
      root: ROOT,
      id: competitor.id,
      title: competitor.displayName ?? competitor.handle,
      existing,
      now,
      data: {
        handle: competitor.handle,
        display_name: competitor.displayName ?? null,
        niche: competitor.niche ?? null,
        tint: competitor.tint ?? null,
        followers: competitor.followers ?? null,
        avg_likes: competitor.avgLikes ?? null,
        level: competitor.level ?? null,
        platform: competitor.platform,
        status: competitor.status,
        favorite: competitor.favorite,
      },
      body,
    })
  }

  private ensureAnchor(competitor: Competitor): void {
    const current = this.db.prepare(
      'SELECT handle, project_id, deleted_at FROM competitors WHERE id = ?',
    ).get(competitor.id) as { handle: string; project_id: string | null; deleted_at: number | null } | undefined
    if (
      current && current.deleted_at == null && current.handle === competitor.handle &&
      (current.project_id ?? 'default') === (competitor.projectId ?? 'default')
    ) return
    this.db.prepare(`
      UPDATE competitors SET deleted_at = ?
      WHERE lower(handle) = lower(?) AND id <> ? AND deleted_at IS NULL
    `).run(Date.now(), competitor.handle, competitor.id)
    this.db.prepare(`
      INSERT INTO competitors (
        id, handle, project_id, post_count, platform, status, favorite, added_at, updated_at
      ) VALUES (?, ?, ?, 0, 'instagram', 'active', 0, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        handle = excluded.handle,
        project_id = excluded.project_id,
        deleted_at = NULL
    `).run(
      competitor.id,
      competitor.handle,
      competitor.projectId ?? 'default',
      competitor.addedAt,
      competitor.updatedAt,
    )
  }

  private runtime(id: string): Pick<Competitor, 'postCount' | 'lastRefreshedAt' | 'baselineLikes' | 'baselineSampleSize' | 'baselineUpdatedAt'> {
    const row = this.db.prepare(`
      SELECT post_count, last_refreshed_at, baseline_likes, baseline_sample_size, baseline_updated_at
      FROM competitors WHERE id = ?
    `).get(id) as RuntimeRow | undefined
    return {
      postCount: row?.post_count ?? 0,
      lastRefreshedAt: row?.last_refreshed_at ?? undefined,
      baselineLikes: row?.baseline_likes ?? undefined,
      baselineSampleSize: row?.baseline_sample_size ?? undefined,
      baselineUpdatedAt: row?.baseline_updated_at ?? undefined,
    }
  }
}

const RUNTIME_FIELDS = new Set(['postCount', 'lastRefreshedAt', 'baselineLikes', 'baselineSampleSize', 'baselineUpdatedAt'])

function toCompetitor(document: MarkdownDocument): Competitor {
  const data = parseDocumentData(document, CompetitorData, 'competitor')
  return {
    id: data.id,
    handle: canonicalHandle(data.handle),
    projectId: data.project_id,
    displayName: data.display_name ?? undefined,
    niche: data.niche ?? undefined,
    tint: data.tint ?? undefined,
    followers: data.followers ?? undefined,
    avgLikes: data.avg_likes ?? undefined,
    postCount: 0,
    notes: readSection(document.body, 'Notes'),
    bio: readSection(document.body, 'Bio'),
    level: data.level ?? undefined,
    platform: data.platform,
    status: data.status,
    favorite: data.favorite,
    addedAt: Date.parse(data.created_at),
    updatedAt: Date.parse(data.updated_at),
  }
}

function assertUniqueHandles(
  entries: Array<{ document: MarkdownDocument; competitor: Competitor }>,
): void {
  const seen = new Map<string, MarkdownDocument>()
  for (const { document, competitor } of entries) {
    const key = canonicalHandle(competitor.handle)
    const previous = seen.get(key)
    if (previous) {
      throw new DocumentStoreError(
        'DUPLICATE_DOCUMENT_FIELD',
        `Duplicate competitor handle ${key}`,
        { field: 'handle', value: key, paths: [previous.relativePath, document.relativePath] },
      )
    }
    seen.set(key, document)
  }
}

function canonicalHandle(handle: string): string {
  const normalized = handle.trim().toLowerCase()
  return normalized.startsWith('@') ? normalized : `@${normalized}`
}
