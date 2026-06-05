import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { freshDb } from './helpers/db.js'
import { BrandWorkspacesRepo } from '../src/db/repositories/brand-workspaces-repo.js'
import {
  KnowledgeDocumentsRepo,
  type NewKnowledgeDocument,
} from '../src/db/repositories/knowledge-documents-repo.js'

const here = dirname(fileURLToPath(import.meta.url))
function sqlFor(file: string): string {
  return readFileSync(join(here, '../src/db/migrations', file), 'utf8')
}
const migrations = [
  { version: 8, sql: sqlFor('008_brand_workspaces.sql') },
  { version: 9, sql: sqlFor('009_knowledge_documents.sql') },
  { version: 12, sql: sqlFor('012_knowledge_documents_embedding.sql') },
]

function setup() {
  const db = freshDb(migrations)
  const workspaces = new BrandWorkspacesRepo(db)
  for (const id of ['workspace-a', 'workspace-b']) {
    workspaces.insert({
      id, name: id, brandSummary: null,
      toneOfVoice: [], audience: [], offers: [], constraints: [],
      status: 'active', createdAt: 100, updatedAt: 100,
    })
  }
  return new KnowledgeDocumentsRepo(db)
}

function doc(over: Partial<NewKnowledgeDocument>): NewKnowledgeDocument {
  return {
    id: over.id ?? `d-${Math.random().toString(36).slice(2)}`,
    embedding: over.embedding,
    scope: over.scope ?? 'workspace',
    workspaceId: 'workspaceId' in over ? (over.workspaceId ?? null) : 'workspace-a',
    platform: over.platform ?? null,
    sourceType: over.sourceType ?? 'manual_note',
    title: over.title ?? 'Untitled',
    extractedText: over.extractedText ?? 'body',
    summary: over.summary ?? null,
    tags: over.tags ?? [],
    topics: over.topics ?? [],
    entities: over.entities ?? [],
    status: over.status ?? 'active',
    contentHash: over.contentHash ?? 'hash',
    createdAt: over.createdAt ?? 100,
    updatedAt: over.updatedAt ?? 100,
  }
}

describe('KnowledgeDocumentsRepo.search — scope isolation', () => {
  it('does not retrieve documents from another workspace (spec §22.1)', () => {
    const repo = setup()
    repo.insert(doc({ workspaceId: 'workspace-a', extractedText: 'Skincare brand A' }))
    repo.insert(doc({ workspaceId: 'workspace-b', extractedText: 'Skincare brand B' }))

    const results = repo.search({
      workspaceId: 'workspace-a',
      platform: 'instagram',
      query: 'skincare',
    })

    expect(results.length).toBeGreaterThan(0)
    expect(
      results.every((r) => r.scope === 'global' || r.workspaceId === 'workspace-a'),
    ).toBe(true)
  })

  it('allows global knowledge across workspaces (spec §22.2)', () => {
    const repo = setup()
    repo.insert(doc({
      scope: 'global', workspaceId: null,
      title: 'Instagram hook framework', extractedText: 'hook framework',
      sourceType: 'global_framework',
    }))

    const results = repo.search({
      workspaceId: 'workspace-a',
      platform: 'instagram',
      query: 'hook framework',
    })

    expect(results.some((r) => r.scope === 'global')).toBe(true)
  })

  it('does not retrieve a TikTok-only doc for an Instagram task (spec §22.3)', () => {
    const repo = setup()
    repo.insert(doc({
      scope: 'global', workspaceId: null, platform: 'tiktok',
      title: 'TikTok trend hook', extractedText: 'trend hook',
      sourceType: 'global_framework',
    }))

    const results = repo.search({
      workspaceId: 'workspace-a',
      platform: 'instagram',
      query: 'trend hook',
    })

    expect(results.every((r) => r.platform !== 'tiktok')).toBe(true)
  })

  it('excludes non-active documents by default', () => {
    const repo = setup()
    repo.insert(doc({ workspaceId: 'workspace-a', status: 'deprecated', extractedText: 'old advice' }))
    const results = repo.search({
      workspaceId: 'workspace-a', platform: 'instagram', query: 'old advice',
    })
    expect(results).toHaveLength(0)
  })

  it('can exclude global results when includeGlobal is false', () => {
    const repo = setup()
    repo.insert(doc({ scope: 'global', workspaceId: null, extractedText: 'global note' }))
    const results = repo.search({
      workspaceId: 'workspace-a', platform: 'instagram', query: 'global note',
      includeGlobal: false,
    })
    expect(results).toHaveLength(0)
  })
})

describe('KnowledgeDocumentsRepo.searchSemantic', () => {
  it('ranks scoped docs by cosine to the query embedding', () => {
    const repo = setup()
    repo.insert(doc({ id: 'near', workspaceId: 'workspace-a', extractedText: 'hooks',
      embedding: Float32Array.from([1, 0, 0, 0]) }))
    repo.insert(doc({ id: 'far', workspaceId: 'workspace-a', extractedText: 'hooks',
      embedding: Float32Array.from([0, 1, 0, 0]) }))
    repo.insert(doc({ id: 'other-ws', workspaceId: 'workspace-b', extractedText: 'hooks',
      embedding: Float32Array.from([1, 0, 0, 0]) }))

    const results = repo.searchSemantic({
      workspaceId: 'workspace-a', platform: 'instagram',
      queryEmbedding: Float32Array.from([1, 0, 0, 0]),
    })

    expect(results.map((r) => r.id)).toEqual(['near', 'far'])
    expect(results.every((r) => r.scope === 'global' || r.workspaceId === 'workspace-a')).toBe(true)
  })

  it('ignores documents without an embedding', () => {
    const repo = setup()
    repo.insert(doc({ id: 'no-emb', workspaceId: 'workspace-a' })) // embedding undefined
    const results = repo.searchSemantic({
      workspaceId: 'workspace-a', platform: 'instagram',
      queryEmbedding: Float32Array.from([1, 0, 0, 0]),
    })
    expect(results).toHaveLength(0)
  })
})
