import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import type { CapturedPost } from '@anubis/conversation'
import type {
  ImportSnapshotResult,
  ProjectSnapshot,
  SnapshotCapturedPost,
  SnapshotCompetitor,
} from '@anubis/shared'
import { getStack } from './services.js'
import { HttpError } from './http-errors.js'

/* ---------- version (informational only) ---------- */

function readAppVersion(): string {
  try {
    const require = createRequire(import.meta.url)
    const pkg = require('../../../package.json') as { version?: string }
    return pkg.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

function notFound(projectId: string): HttpError {
  return new HttpError(404, {
    ok: false,
    error: { code: 'NOT_FOUND', message: `Project not found: ${projectId}` },
  })
}

/* ---------- export ---------- */

export function buildSnapshot(projectId: string): ProjectSnapshot {
  const stack = getStack()
  const project = stack.projects.findById(projectId)
  if (!project) throw notFound(projectId)

  const competitors = stack.competitors.list(projectId)

  const snapCompetitors: SnapshotCompetitor[] = competitors.map((c) => ({
    handle: c.handle,
    displayName: c.displayName,
    niche: c.niche,
    tint: c.tint,
    followers: c.followers,
    avgLikes: c.avgLikes,
    baselineLikes: c.baselineLikes,
    baselineSampleSize: c.baselineSampleSize,
    baselineUpdatedAt: c.baselineUpdatedAt,
    postCount: c.postCount,
    lastRefreshedAt: c.lastRefreshedAt,
    notes: c.notes,
    bio: c.bio,
    level: c.level,
    addedAt: c.addedAt,
    updatedAt: c.updatedAt,
  }))

  const snapPosts: SnapshotCapturedPost[] = []
  for (const c of competitors) {
    // High limit so we export every post for the competitor (list() defaults to 200).
    const posts = stack.capturedPosts.list({ competitorId: c.id, limit: 1_000_000 })
    for (const p of posts) {
      snapPosts.push({
        competitorHandle: c.handle,
        username: p.username,
        postUrl: p.postUrl,
        caption: p.caption,
        likes: p.likes,
        comments: p.comments,
        postedAt: p.postedAt,
        mediaKind: p.mediaKind,
        mediaUrl: p.mediaUrl,
        carouselCount: p.carouselCount,
        capturedAt: p.capturedAt,
        raw: p.raw,
      })
    }
  }

  return {
    kind: 'anubis-project-snapshot',
    schemaVersion: 1,
    exportedAt: Date.now(),
    app: { name: 'anubis', version: readAppVersion() },
    project: {
      id: project.id,
      name: project.name,
      emoji: project.emoji,
      color: project.color,
      description: project.description,
    },
    competitors: snapCompetitors,
    capturedPosts: snapPosts,
  }
}

/* ---------- import ---------- */

const SnapshotCompetitorSchema = z.object({
  handle: z.string().min(1),
  displayName: z.string().optional(),
  niche: z.string().optional(),
  tint: z.string().optional(),
  followers: z.number().int().nonnegative().optional(),
  avgLikes: z.number().int().nonnegative().optional(),
  baselineLikes: z.number().int().nonnegative().optional(),
  baselineSampleSize: z.number().int().nonnegative().optional(),
  baselineUpdatedAt: z.number().int().nonnegative().optional(),
  postCount: z.number().int().nonnegative().optional(),
  lastRefreshedAt: z.number().int().nonnegative().optional(),
  notes: z.string().optional(),
  bio: z.string().optional(),
  level: z.enum(['black', 'green', 'yellow', 'red']).optional(),
  addedAt: z.number().int().nonnegative().optional(),
  updatedAt: z.number().int().nonnegative().optional(),
})

const SnapshotCapturedPostSchema = z.object({
  competitorHandle: z.string().min(1),
  username: z.string().min(1),
  postUrl: z.string().min(1),
  caption: z.string().optional(),
  likes: z.number().int().nonnegative().optional(),
  comments: z.number().int().nonnegative().optional(),
  postedAt: z.string().optional(),
  mediaKind: z.enum(['image', 'video', 'carousel']).optional(),
  mediaUrl: z.string().optional(),
  carouselCount: z.number().int().nonnegative().optional(),
  capturedAt: z.number().int().nonnegative().optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
})

export const ProjectSnapshotSchema = z.object({
  kind: z.literal('anubis-project-snapshot'),
  schemaVersion: z.literal(1),
  exportedAt: z.number().optional(),
  app: z.object({ name: z.string().optional(), version: z.string().optional() }).optional(),
  project: z
    .object({
      id: z.string().optional(),
      name: z.string().optional(),
      emoji: z.string().optional(),
      color: z.string().optional(),
      description: z.string().optional(),
    })
    .optional(),
  competitors: z.array(SnapshotCompetitorSchema),
  capturedPosts: z.array(SnapshotCapturedPostSchema),
})

type ValidatedSnapshot = z.infer<typeof ProjectSnapshotSchema>

function normHandle(handle: string): string {
  return handle.trim().toLowerCase()
}

function hasSnapshotBaseline(
  sc: Pick<SnapshotCompetitor, 'baselineLikes' | 'baselineSampleSize' | 'baselineUpdatedAt'>,
): boolean {
  return (
    sc.baselineLikes !== undefined ||
    sc.baselineSampleSize !== undefined ||
    sc.baselineUpdatedAt !== undefined
  )
}

export function importSnapshot(
  targetProjectId: string,
  snapshot: ValidatedSnapshot,
): ImportSnapshotResult {
  const stack = getStack()
  if (!stack.projects.findById(targetProjectId)) throw notFound(targetProjectId)

  const createdCompetitorIds: string[] = []
  try {
    return stack.transaction((): ImportSnapshotResult => {
      const warnings: string[] = []
      let created = 0
      let matched = 0
      const importedAt = Date.now()

      const applyBaseline = (id: string, sc: ValidatedSnapshot['competitors'][number]) => {
        if (!hasSnapshotBaseline(sc)) return
        const current = stack.competitors.get(id)
        stack.competitors.setBaseline(id, {
          baselineLikes: sc.baselineLikes ?? current?.baselineLikes ?? null,
          baselineSampleSize: sc.baselineSampleSize ?? current?.baselineSampleSize ?? 0,
          baselineUpdatedAt: sc.baselineUpdatedAt ?? current?.baselineUpdatedAt ?? importedAt,
        })
      }

      // Handles are globally unique → resolve against ALL competitors.
      const byHandle = new Map<string, { id: string; projectId: string }>()
      for (const c of stack.competitors.list()) {
        byHandle.set(normHandle(c.handle), { id: c.id, projectId: c.projectId ?? 'default' })
      }

      // 1. Resolve or create competitors.
      for (const sc of snapshot.competitors) {
        const key = normHandle(sc.handle)
        const existing = byHandle.get(key)
        if (existing) {
          applyBaseline(existing.id, sc)
          matched++
          continue
        }
        const c = stack.competitors.create({
          handle: sc.handle,
          projectId: targetProjectId,
          displayName: sc.displayName,
          niche: sc.niche,
          tint: sc.tint,
          followers: sc.followers,
          avgLikes: sc.avgLikes,
          notes: sc.notes,
          bio: sc.bio,
          level: sc.level,
        })
        applyBaseline(c.id, sc)
        createdCompetitorIds.push(c.id)
        byHandle.set(key, { id: c.id, projectId: c.projectId ?? targetProjectId })
        created++
      }

      // 2. Build post rows; collect orphans (handle not in file or DB).
      const rows: CapturedPost[] = []
      let orphans = 0
      for (const sp of snapshot.capturedPosts) {
        const owner = byHandle.get(normHandle(sp.competitorHandle))
        if (!owner) {
          orphans++
          continue
        }
        rows.push({
          id: randomUUID(),
          competitorId: owner.id,
          projectId: owner.projectId,
          username: sp.username,
          postUrl: sp.postUrl,
          caption: sp.caption,
          likes: sp.likes,
          comments: sp.comments,
          postedAt: sp.postedAt,
          mediaKind: sp.mediaKind,
          mediaUrl: sp.mediaUrl,
          carouselCount: sp.carouselCount,
          capturedAt: sp.capturedAt ?? importedAt,
          raw: sp.raw,
        })
      }
      if (orphans > 0) {
        warnings.push(`${orphans} post(s) skipped: competitor handle not found in snapshot or database.`)
      }

      // 3. Net-new = sum of per-competitor counts after minus before.
      const affected = [...new Set(rows.map((r) => r.competitorId))]
      const countAll = () =>
        affected.reduce((n, id) => n + stack.capturedPosts.countForCompetitor(id), 0)
      const before = countAll()
      const { inserted: uniqueCandidates } = stack.capturedPosts.upsertMany(rows)
      const after = countAll()
      const imported = after - before
      const skipped = uniqueCandidates - imported

      // 4. Refresh competitor post counts.
      for (const id of affected) {
        stack.competitors.update(id, { postCount: stack.capturedPosts.countForCompetitor(id) })
      }

      return {
        ok: true,
        projectId: targetProjectId,
        competitors: { created, matched },
        posts: { imported, skipped },
        warnings,
      }
    })
  } catch (error) {
    // SQLite rolls back automatically; compensate for canonical files written
    // during the transaction so a failed import does not leave partial docs.
    for (const id of createdCompetitorIds.reverse()) stack.competitors.remove(id)
    throw error
  }
}

/* ---------- routes ---------- */

const ImportBody = z.object({
  projectId: z.string().min(1).optional(),
  snapshot: ProjectSnapshotSchema,
}).strict()

export const snapshotRoutes = new Hono()

snapshotRoutes.get('/export', (c) => {
  const projectId = c.req.query('projectId') ?? 'default'
  return c.json({ ok: true, snapshot: buildSnapshot(projectId) })
})

snapshotRoutes.post('/import', async (c) => {
  const body = ImportBody.parse(await c.req.json())
  return c.json(importSnapshot(body.projectId ?? 'default', body.snapshot))
})
