import { randomUUID } from 'node:crypto'
import type { ApprovalStatus, ContentType, Platform } from '../types.js'
import type { Embedder } from '../embedding/embedder.js'
import type {
  ContentSimilarityItem,
  ContentSimilarityItemsRepo,
} from '../db/repositories/content-similarity-items-repo.js'

export interface IngestSimilarityInput {
  workspaceId: string
  platform: Platform
  contentId: string | null
  contentType: ContentType
  caption?: string | null
  transcript?: string | null
  ocrText?: string | null
  visualDescription?: string | null
  performanceScore?: number | null
  engagementScore?: number | null
  brandFitScore?: number | null
  approvalStatus?: ApprovalStatus | null
  rejectionReason?: string | null
}

/** Join the text-bearing fields into the string that gets embedded. */
export function normalizeSimilarityText(p: {
  caption?: string | null
  transcript?: string | null
  ocrText?: string | null
  visualDescription?: string | null
}): string {
  return [p.caption, p.transcript, p.ocrText, p.visualDescription]
    .map((s) => (s ?? '').trim())
    .filter((s) => s.length > 0)
    .join('\n')
}

export class SimilarityIngestionService {
  constructor(
    private items: ContentSimilarityItemsRepo,
    private embedder: Embedder,
  ) {}

  async ingest(
    input: IngestSimilarityInput,
    now: number = Date.now(),
  ): Promise<ContentSimilarityItem> {
    const normalizedText = normalizeSimilarityText(input)
    const embedding = await this.embedder.embed(normalizedText || input.contentType)
    const item: ContentSimilarityItem = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      platform: input.platform,
      contentId: input.contentId,
      contentType: input.contentType,
      caption: input.caption ?? null,
      transcript: input.transcript ?? null,
      ocrText: input.ocrText ?? null,
      visualDescription: input.visualDescription ?? null,
      normalizedText,
      embedding,
      performanceScore: input.performanceScore ?? null,
      engagementScore: input.engagementScore ?? null,
      brandFitScore: input.brandFitScore ?? null,
      approvalStatus: input.approvalStatus ?? null,
      rejectionReason: input.rejectionReason ?? null,
      createdAt: now,
      updatedAt: now,
    }
    this.items.upsert(item)
    return item
  }
}
