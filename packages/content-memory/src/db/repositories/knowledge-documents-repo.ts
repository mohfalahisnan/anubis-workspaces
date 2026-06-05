import type { Db } from '../types.js'
import type { DocumentStatus, Platform, Scope, SourceType } from '../../types.js'

export interface KnowledgeDocument {
  id: string
  scope: Scope
  workspaceId: string | null
  platform: Platform | null
  sourceType: SourceType
  title: string
  extractedText: string
  summary: string | null
  tags: string[]
  topics: string[]
  entities: string[]
  status: DocumentStatus
  contentHash: string
  createdAt: number
  updatedAt: number
}

export type NewKnowledgeDocument = KnowledgeDocument

export interface SearchKnowledgeInput {
  workspaceId: string
  platform: Platform
  query: string
  includeGlobal?: boolean
  limit?: number
}

/** A document plus a lexical relevance score (semantic ranking arrives in a later phase). */
export type ScoredDocument = KnowledgeDocument & { score: number }

interface Row {
  id: string
  scope: string
  workspace_id: string | null
  platform: string | null
  source_type: string
  title: string
  extracted_text: string
  summary: string | null
  tags: string
  topics: string
  entities: string
  status: string
  content_hash: string
  created_at: number
  updated_at: number
}

function parseArr(s: string): string[] {
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? (v as string[]) : []
  } catch {
    return []
  }
}

function toDoc(r: Row): KnowledgeDocument {
  return {
    id: r.id,
    scope: r.scope as Scope,
    workspaceId: r.workspace_id,
    platform: (r.platform as Platform | null) ?? null,
    sourceType: r.source_type as SourceType,
    title: r.title,
    extractedText: r.extracted_text,
    summary: r.summary,
    tags: parseArr(r.tags),
    topics: parseArr(r.topics),
    entities: parseArr(r.entities),
    status: r.status as DocumentStatus,
    contentHash: r.content_hash,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

/** Count case-insensitive occurrences of query terms across title + body. */
function lexicalScore(doc: KnowledgeDocument, query: string): number {
  const hay = `${doc.title} ${doc.extractedText}`.toLowerCase()
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  let score = 0
  for (const t of terms) {
    let from = 0
    for (;;) {
      const i = hay.indexOf(t, from)
      if (i === -1) break
      score += 1
      from = i + t.length
    }
  }
  return score
}

export class KnowledgeDocumentsRepo {
  constructor(private db: Db) {}

  insert(d: NewKnowledgeDocument): void {
    this.db.prepare(`
      INSERT INTO knowledge_documents (
        id, scope, workspace_id, platform, source_type, title, extracted_text,
        summary, tags, topics, entities, status, content_hash, created_at, updated_at
      ) VALUES (
        @id, @scope, @workspaceId, @platform, @sourceType, @title, @extractedText,
        @summary, @tags, @topics, @entities, @status, @contentHash, @createdAt, @updatedAt
      )
    `).run({
      id: d.id,
      scope: d.scope,
      workspaceId: d.workspaceId ?? null,
      platform: d.platform ?? null,
      sourceType: d.sourceType,
      title: d.title,
      extractedText: d.extractedText,
      summary: d.summary ?? null,
      tags: JSON.stringify(d.tags),
      topics: JSON.stringify(d.topics),
      entities: JSON.stringify(d.entities),
      status: d.status,
      contentHash: d.contentHash,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    })
  }

  /**
   * Scope + platform filtering happens in SQL, BEFORE ranking (spec §11).
   * Lexical scoring is applied in JS afterward; semantic ranking is a later phase.
   */
  search(input: SearchKnowledgeInput): ScoredDocument[] {
    const includeGlobal = input.includeGlobal ?? true
    const like = `%${input.query}%`
    const rows = this.db.prepare(`
      SELECT * FROM knowledge_documents
      WHERE status = 'active'
        AND (
          workspace_id = @workspaceId
          OR (@includeGlobal = 1 AND scope = 'global')
        )
        AND (platform IS NULL OR platform = @platform OR platform = 'general')
        AND (extracted_text LIKE @like OR title LIKE @like)
    `).all({
      workspaceId: input.workspaceId,
      includeGlobal: includeGlobal ? 1 : 0,
      platform: input.platform,
      like,
    }) as Row[]

    const scored = rows
      .map(toDoc)
      .map((d) => ({ ...d, score: lexicalScore(d, input.query) }))
      .sort((a, b) => b.score - a.score || b.createdAt - a.createdAt)

    return typeof input.limit === 'number' ? scored.slice(0, input.limit) : scored
  }
}
