import type { ContentItemStatus } from '@anubis/shared'
import type { Db } from '../client.js'

export interface ContentItem {
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
  analyticsLikes?: number
  analyticsComments?: number
  analyticsSaves?: number
  metricsSyncedAt?: number
  sourceWorkflowRunId?: string
  sourceConversationId?: string
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

interface Row {
  id: string
  project_id: string | null
  reference_post_id: string | null
  reference_url: string | null
  title: string
  status: ContentItemStatus
  raw_brief: string | null
  improved_draft: string | null
  rejection_reason: string | null
  published_url: string | null
  published_at: string | null
  analytics_likes: number | null
  analytics_comments: number | null
  analytics_saves: number | null
  metrics_synced_at: number | null
  source_workflow_run_id: string | null
  source_conversation_id: string | null
  created_at: number
  updated_at: number
  deleted_at: number | null
}

export interface ListContentItemsOpts {
  projectId?: string
  status?: ContentItemStatus
  limit?: number
}

export interface CreateContentItemInput {
  id: string
  projectId?: string
  referencePostId?: string
  referenceUrl?: string
  title: string
  status?: ContentItemStatus
  rawBrief?: string
  improvedDraft?: string
  sourceWorkflowRunId?: string
  sourceConversationId?: string
  now: number
}

export type UpdateContentItemPatch = Partial<Omit<ContentItem, 'id' | 'projectId' | 'referencePostId' | 'referenceUrl' | 'createdAt' | 'deletedAt'>>

function toItem(row: Row): ContentItem {
  return {
    id: row.id,
    projectId: row.project_id ?? undefined,
    referencePostId: row.reference_post_id ?? undefined,
    referenceUrl: row.reference_url ?? undefined,
    title: row.title,
    status: row.status,
    rawBrief: row.raw_brief ?? undefined,
    improvedDraft: row.improved_draft ?? undefined,
    rejectionReason: row.rejection_reason ?? undefined,
    publishedUrl: row.published_url ?? undefined,
    publishedAt: row.published_at ?? undefined,
    analyticsLikes: row.analytics_likes ?? undefined,
    analyticsComments: row.analytics_comments ?? undefined,
    analyticsSaves: row.analytics_saves ?? undefined,
    metricsSyncedAt: row.metrics_synced_at ?? undefined,
    sourceWorkflowRunId: row.source_workflow_run_id ?? undefined,
    sourceConversationId: row.source_conversation_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? undefined,
  }
}

export class ContentItemsRepo {
  constructor(private db: Db) {}

  create(input: CreateContentItemInput): ContentItem {
    this.db
      .prepare(`
        INSERT INTO content_items (
          id, project_id, reference_post_id, reference_url, title, status, raw_brief, improved_draft,
          source_workflow_run_id, source_conversation_id, created_at, updated_at
        ) VALUES (
          @id, @projectId, @referencePostId, @referenceUrl, @title, @status, @rawBrief, @improvedDraft,
          @sourceWorkflowRunId, @sourceConversationId, @createdAt, @updatedAt
        )
      `)
      .run({
        id: input.id,
        projectId: input.projectId ?? 'default',
        referencePostId: input.referencePostId ?? null,
        referenceUrl: input.referenceUrl ?? null,
        title: input.title,
        status: input.status ?? 'idea',
        rawBrief: input.rawBrief ?? null,
        improvedDraft: input.improvedDraft ?? null,
        sourceWorkflowRunId: input.sourceWorkflowRunId ?? null,
        sourceConversationId: input.sourceConversationId ?? null,
        createdAt: input.now,
        updatedAt: input.now,
      })
    return this.findByIdOrThrow(input.id)
  }

  findById(id: string): ContentItem | null {
    const row = this.db
      .prepare('SELECT * FROM content_items WHERE id = ? AND deleted_at IS NULL')
      .get(id) as Row | undefined
    return row ? toItem(row) : null
  }

  findByIdOrThrow(id: string): ContentItem {
    const item = this.findById(id)
    if (!item) throw new Error(`content item ${id} not found`)
    return item
  }

  list(opts: ListContentItemsOpts = {}): ContentItem[] {
    const where = ['deleted_at IS NULL']
    const params: unknown[] = []
    if (opts.projectId) { where.push('project_id = ?'); params.push(opts.projectId) }
    if (opts.status) { where.push('status = ?'); params.push(opts.status) }
    params.push(opts.limit ?? 200)
    const rows = this.db
      .prepare(`SELECT * FROM content_items WHERE ${where.join(' AND ')} ORDER BY updated_at DESC LIMIT ?`)
      .all(...params) as Row[]
    return rows.map(toItem)
  }

  update(id: string, patch: UpdateContentItemPatch): ContentItem | null {
    const current = this.findById(id)
    if (!current) return null
    const next: ContentItem = { ...current, ...patch, updatedAt: Date.now() }
    this.db
      .prepare(`
        UPDATE content_items SET
          title = ?,
          status = ?,
          raw_brief = ?,
          improved_draft = ?,
          rejection_reason = ?,
          published_url = ?,
          published_at = ?,
          analytics_likes = ?,
          analytics_comments = ?,
          analytics_saves = ?,
          metrics_synced_at = ?,
          source_workflow_run_id = ?,
          source_conversation_id = ?,
          updated_at = ?
        WHERE id = ? AND deleted_at IS NULL
      `)
      .run(
        next.title,
        next.status,
        next.rawBrief ?? null,
        next.improvedDraft ?? null,
        next.rejectionReason ?? null,
        next.publishedUrl ?? null,
        next.publishedAt ?? null,
        next.analyticsLikes ?? null,
        next.analyticsComments ?? null,
        next.analyticsSaves ?? null,
        next.metricsSyncedAt ?? null,
        next.sourceWorkflowRunId ?? null,
        next.sourceConversationId ?? null,
        next.updatedAt,
        id,
      )
    return next
  }

  softDelete(id: string): ContentItem | null {
    const current = this.findById(id)
    if (!current) return null
    this.db
      .prepare('UPDATE content_items SET deleted_at = ?, updated_at = ? WHERE id = ?')
      .run(Date.now(), Date.now(), id)
    return current
  }
}
