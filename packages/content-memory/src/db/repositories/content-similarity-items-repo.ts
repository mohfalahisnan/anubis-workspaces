import type { Db } from '../types.js'
import type { ApprovalStatus, ContentType, Platform } from '../../types.js'
import { cosine, fromBlob, toBlob } from '../../embedding/vector.js'

export interface ContentSimilarityItem {
  id: string
  workspaceId: string
  platform: Platform
  contentId: string | null
  contentType: ContentType
  caption: string | null
  transcript: string | null
  ocrText: string | null
  visualDescription: string | null
  normalizedText: string
  embedding: Float32Array
  performanceScore: number | null
  engagementScore: number | null
  brandFitScore: number | null
  approvalStatus: ApprovalStatus | null
  rejectionReason: string | null
  createdAt: number
  updatedAt: number
}

export interface SearchSimilarInput {
  workspaceId: string
  platform: Platform
  queryEmbedding: Float32Array
  contentTypes?: ContentType[]
  approvalStatuses?: ApprovalStatus[]
  limit?: number
}

export type ScoredSimilarityItem = ContentSimilarityItem & { score: number }

interface Row {
  id: string
  workspace_id: string
  platform: string
  content_id: string | null
  content_type: string
  caption: string | null
  transcript: string | null
  ocr_text: string | null
  visual_description: string | null
  normalized_text: string
  embedding: Buffer
  performance_score: number | null
  engagement_score: number | null
  brand_fit_score: number | null
  approval_status: string | null
  rejection_reason: string | null
  created_at: number
  updated_at: number
}

function toItem(r: Row): ContentSimilarityItem {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    platform: r.platform as Platform,
    contentId: r.content_id,
    contentType: r.content_type as ContentType,
    caption: r.caption,
    transcript: r.transcript,
    ocrText: r.ocr_text,
    visualDescription: r.visual_description,
    normalizedText: r.normalized_text,
    embedding: fromBlob(r.embedding),
    performanceScore: r.performance_score,
    engagementScore: r.engagement_score,
    brandFitScore: r.brand_fit_score,
    approvalStatus: (r.approval_status as ApprovalStatus | null) ?? null,
    rejectionReason: r.rejection_reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export class ContentSimilarityItemsRepo {
  constructor(private db: Db) {}

  upsert(it: ContentSimilarityItem): void {
    this.db.prepare(`
      INSERT INTO content_similarity_items (
        id, workspace_id, platform, content_id, content_type, caption, transcript,
        ocr_text, visual_description, normalized_text, embedding, performance_score,
        engagement_score, brand_fit_score, approval_status, rejection_reason,
        created_at, updated_at
      ) VALUES (
        @id, @workspaceId, @platform, @contentId, @contentType, @caption, @transcript,
        @ocrText, @visualDescription, @normalizedText, @embedding, @performanceScore,
        @engagementScore, @brandFitScore, @approvalStatus, @rejectionReason,
        @createdAt, @updatedAt
      )
      ON CONFLICT(workspace_id, content_id) WHERE content_id IS NOT NULL DO UPDATE SET
        platform = excluded.platform,
        content_type = excluded.content_type,
        caption = excluded.caption,
        transcript = excluded.transcript,
        ocr_text = excluded.ocr_text,
        visual_description = excluded.visual_description,
        normalized_text = excluded.normalized_text,
        embedding = excluded.embedding,
        performance_score = excluded.performance_score,
        engagement_score = excluded.engagement_score,
        brand_fit_score = excluded.brand_fit_score,
        approval_status = excluded.approval_status,
        rejection_reason = excluded.rejection_reason,
        updated_at = excluded.updated_at
    `).run({
      id: it.id,
      workspaceId: it.workspaceId,
      platform: it.platform,
      contentId: it.contentId ?? null,
      contentType: it.contentType,
      caption: it.caption ?? null,
      transcript: it.transcript ?? null,
      ocrText: it.ocrText ?? null,
      visualDescription: it.visualDescription ?? null,
      normalizedText: it.normalizedText,
      embedding: toBlob(it.embedding),
      performanceScore: it.performanceScore ?? null,
      engagementScore: it.engagementScore ?? null,
      brandFitScore: it.brandFitScore ?? null,
      approvalStatus: it.approvalStatus ?? null,
      rejectionReason: it.rejectionReason ?? null,
      createdAt: it.createdAt,
      updatedAt: it.updatedAt,
    })
  }

  /** Scope (workspace + platform) filtered in SQL BEFORE cosine ranking in JS. */
  search(input: SearchSimilarInput): ScoredSimilarityItem[] {
    const where: string[] = ['workspace_id = ?', 'platform = ?']
    const params: unknown[] = [input.workspaceId, input.platform]

    if (input.contentTypes?.length) {
      where.push(`content_type IN (${input.contentTypes.map(() => '?').join(', ')})`)
      params.push(...input.contentTypes)
    }
    if (input.approvalStatuses?.length) {
      where.push(`approval_status IN (${input.approvalStatuses.map(() => '?').join(', ')})`)
      params.push(...input.approvalStatuses)
    }

    const rows = this.db
      .prepare(`SELECT * FROM content_similarity_items WHERE ${where.join(' AND ')}`)
      .all(...params) as Row[]

    const scored = rows
      .map(toItem)
      .map((it) => ({ ...it, score: cosine(it.embedding, input.queryEmbedding) }))
      .sort((a, b) => b.score - a.score || b.createdAt - a.createdAt)

    return typeof input.limit === 'number' ? scored.slice(0, input.limit) : scored
  }
}
