import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import type { Platform, Scope, SourceType } from '../types.js'
import type { Embedder } from '../embedding/embedder.js'
import type { KnowledgeDocumentsRepo, KnowledgeDocument } from '../db/repositories/knowledge-documents-repo.js'

export interface IngestKnowledgeInput {
  scope: Scope
  workspaceId?: string | null
  platform?: Platform | null
  sourceType: SourceType
  title: string
  text: string
  summary?: string | null
  tags?: string[]
  topics?: string[]
  entities?: string[]
}

export class KnowledgeIngestionService {
  constructor(
    private docs: KnowledgeDocumentsRepo,
    private embedder: Embedder,
  ) {}

  async ingest(input: IngestKnowledgeInput, now: number = Date.now()): Promise<KnowledgeDocument> {
    const embedding = await this.embedder.embed(`${input.title}\n${input.text}`)
    const doc: KnowledgeDocument = {
      id: randomUUID(),
      scope: input.scope,
      workspaceId: input.scope === 'global' ? null : (input.workspaceId ?? null),
      platform: input.platform ?? null,
      sourceType: input.sourceType,
      title: input.title,
      extractedText: input.text,
      summary: input.summary ?? null,
      tags: input.tags ?? [],
      topics: input.topics ?? [],
      entities: input.entities ?? [],
      embedding,
      status: 'active',
      contentHash: createHash('sha256').update(`${input.title}\n${input.text}`).digest('hex'),
      createdAt: now,
      updatedAt: now,
    }
    this.docs.insert(doc)
    return doc
  }
}
