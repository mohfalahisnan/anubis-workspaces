import type { ContentItemStatus } from '@anubis/shared'
import { z } from 'zod'
import type { Db } from '../client.js'
import { FrontmatterDateString, parseDocumentData, type MarkdownDocument, type MarkdownDocumentStore } from '../../documents/document-store.js'
import { readSection, writeSections } from '../../documents/markdown-sections.js'

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
  sourceCandidateId?: string
  createdAt: number
  updatedAt: number
  deletedAt?: number
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
  sourceCandidateId?: string
  now: number
}

export type UpdateContentItemPatch = Partial<Omit<ContentItem, 'id' | 'projectId' | 'referencePostId' | 'referenceUrl' | 'createdAt' | 'deletedAt'>>

const ROOT = 'knowledge/content'
const ContentData = z.object({
  id: z.string(),
  project_id: z.string(),
  title: z.string().min(1),
  status: z.enum(['idea', 'raw_extracted', 'brief', 'content_refined', 'ai_review', 'human_review', 'generating', 'draft', 'review', 'scheduled', 'published', 'rejected']),
  reference_post_id: z.string().optional().nullable(),
  reference_url: z.string().optional().nullable(),
  source_candidate_id: z.string().optional().nullable(),
  rejection_reason: z.string().optional().nullable(),
  published_url: z.string().optional().nullable(),
  published_at: FrontmatterDateString.optional().nullable(),
  source_workflow_run_id: z.string().optional().nullable(),
  source_conversation_id: z.string().optional().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
}).passthrough()

interface RuntimeRow {
  analytics_likes: number | null
  analytics_comments: number | null
  analytics_saves: number | null
  metrics_synced_at: number | null
}

export class ContentItemsRepo {
  constructor(
    private readonly db: Db,
    private readonly documents: MarkdownDocumentStore,
  ) {}

  create(input: CreateContentItemInput): ContentItem {
    const item: ContentItem = {
      id: input.id,
      projectId: input.projectId ?? 'default',
      referencePostId: input.referencePostId,
      referenceUrl: input.referenceUrl,
      title: input.title,
      status: input.status ?? 'idea',
      rawBrief: input.rawBrief,
      improvedDraft: input.improvedDraft,
      sourceWorkflowRunId: input.sourceWorkflowRunId,
      sourceConversationId: input.sourceConversationId,
      sourceCandidateId: input.sourceCandidateId,
      createdAt: input.now,
      updatedAt: input.now,
    }
    this.write(item, null, input.now)
    this.ensureRuntime(item.id)
    return this.findByIdOrThrow(item.id)
  }

  findById(id: string): ContentItem | null {
    const document = this.documents.find('content', ROOT, id)
    if (!document) return null
    const item = toItem(document)
    return { ...item, ...this.runtime(id) }
  }

  findByIdOrThrow(id: string): ContentItem {
    const item = this.findById(id)
    if (!item) throw new Error(`content item ${id} not found`)
    return item
  }

  list(opts: ListContentItemsOpts = {}): ContentItem[] {
    let items = this.documents.list('content', ROOT, opts.projectId).map((document) => {
      const item = toItem(document)
      return { ...item, ...this.runtime(item.id) }
    })
    if (opts.status) items = items.filter((item) => item.status === opts.status)
    return items.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, opts.limit ?? 200)
  }

  update(id: string, patch: UpdateContentItemPatch): ContentItem | null {
    const document = this.documents.find('content', ROOT, id)
    if (!document) return null
    const current = this.findById(id)!
    const next: ContentItem = { ...current, ...patch, updatedAt: Date.now() }
    const authored = Object.keys(patch).some((key) => !RUNTIME_FIELDS.has(key))
    if (authored) this.write(next, document, next.updatedAt)
    this.ensureRuntime(id)
    this.db.prepare(`
      UPDATE content_item_runtime SET analytics_likes = ?, analytics_comments = ?,
        analytics_saves = ?, metrics_synced_at = ? WHERE content_id = ?
    `).run(
      next.analyticsLikes ?? null,
      next.analyticsComments ?? null,
      next.analyticsSaves ?? null,
      next.metricsSyncedAt ?? null,
      id,
    )
    return this.findById(id)
  }

  softDelete(id: string): ContentItem | null {
    const current = this.findById(id)
    if (!current) return null
    this.documents.delete('content', ROOT, id)
    this.db.prepare('DELETE FROM content_item_runtime WHERE content_id = ?').run(id)
    return current
  }

  private write(item: ContentItem, existing: MarkdownDocument | null, now: number): void {
    const body = writeSections(existing?.body ?? '', {
      Brief: item.rawBrief,
      Draft: item.improvedDraft,
    })
    this.documents.write({
      type: 'content',
      projectId: item.projectId ?? 'default',
      root: ROOT,
      id: item.id,
      title: item.title,
      existing,
      now,
      data: {
        title: item.title,
        status: item.status,
        reference_post_id: item.referencePostId ?? null,
        reference_url: item.referenceUrl ?? null,
        rejection_reason: item.rejectionReason ?? null,
        published_url: item.publishedUrl ?? null,
        published_at: item.publishedAt ?? null,
        source_workflow_run_id: item.sourceWorkflowRunId ?? null,
        source_conversation_id: item.sourceConversationId ?? null,
        source_candidate_id: item.sourceCandidateId ?? null,
      },
      body,
    })
  }

  private ensureRuntime(id: string): void {
    this.db.prepare('INSERT OR IGNORE INTO content_item_runtime (content_id) VALUES (?)').run(id)
  }

  private runtime(id: string): Pick<ContentItem, 'analyticsLikes' | 'analyticsComments' | 'analyticsSaves' | 'metricsSyncedAt'> {
    let row = this.db.prepare('SELECT * FROM content_item_runtime WHERE content_id = ?').get(id) as RuntimeRow | undefined
    if (!row) {
      this.ensureRuntime(id)
      row = this.db.prepare('SELECT * FROM content_item_runtime WHERE content_id = ?').get(id) as RuntimeRow
    }
    return {
      analyticsLikes: row?.analytics_likes ?? undefined,
      analyticsComments: row?.analytics_comments ?? undefined,
      analyticsSaves: row?.analytics_saves ?? undefined,
      metricsSyncedAt: row?.metrics_synced_at ?? undefined,
    }
  }
}

const RUNTIME_FIELDS = new Set(['analyticsLikes', 'analyticsComments', 'analyticsSaves', 'metricsSyncedAt'])

function toItem(document: MarkdownDocument): ContentItem {
  const data = parseDocumentData(document, ContentData, 'content')
  return {
    id: data.id,
    projectId: data.project_id,
    referencePostId: data.reference_post_id ?? undefined,
    referenceUrl: data.reference_url ?? undefined,
    title: data.title,
    status: data.status,
    rawBrief: readSection(document.body, 'Brief'),
    improvedDraft: readSection(document.body, 'Draft'),
    rejectionReason: data.rejection_reason ?? undefined,
    publishedUrl: data.published_url ?? undefined,
    publishedAt: data.published_at ?? undefined,
    sourceWorkflowRunId: data.source_workflow_run_id ?? undefined,
    sourceConversationId: data.source_conversation_id ?? undefined,
    sourceCandidateId: data.source_candidate_id ?? undefined,
    createdAt: Date.parse(data.created_at),
    updatedAt: Date.parse(data.updated_at),
  }
}
