import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { freshDb } from './helpers/db.js'
import { FakeEmbedder } from './helpers/fake-embedder.js'
import { BrandWorkspacesRepo } from '../src/db/repositories/brand-workspaces-repo.js'
import { KnowledgeDocumentsRepo } from '../src/db/repositories/knowledge-documents-repo.js'
import { KnowledgeIngestionService } from '../src/knowledge/knowledge-ingestion-service.js'

const here = dirname(fileURLToPath(import.meta.url))
const sqlFor = (f: string) => readFileSync(join(here, '../src/db/migrations', f), 'utf8')
const migrations = [
  { version: 8, sql: sqlFor('008_brand_workspaces.sql') },
  { version: 9, sql: sqlFor('009_knowledge_documents.sql') },
  { version: 12, sql: sqlFor('012_knowledge_documents_embedding.sql') },
]

function setup() {
  const db = freshDb(migrations)
  new BrandWorkspacesRepo(db).insert({
    id: 'workspace-a', name: 'A', brandSummary: null,
    toneOfVoice: [], audience: [], offers: [], constraints: [],
    status: 'active', createdAt: 100, updatedAt: 100,
  })
  const docs = new KnowledgeDocumentsRepo(db)
  const svc = new KnowledgeIngestionService(docs, new FakeEmbedder())
  return { docs, svc }
}

describe('KnowledgeIngestionService', () => {
  it('embeds and stores a workspace document, retrievable semantically', async () => {
    const { svc, docs } = setup()
    await svc.ingest({
      scope: 'workspace', workspaceId: 'workspace-a', platform: 'instagram',
      sourceType: 'brand_guideline', title: 'Tone', text: 'warm and educational',
    })
    // Round-trip: query the same string the service embeds (title + body).
    const q = await new FakeEmbedder().embed('Tone\nwarm and educational')
    const results = docs.searchSemantic({
      workspaceId: 'workspace-a', platform: 'instagram', queryEmbedding: q,
    })
    expect(results).toHaveLength(1)
    expect(results[0]!.title).toBe('Tone')
    expect(results[0]!.score).toBeCloseTo(1, 6)
  })

  it('stores a global document with null workspaceId', async () => {
    const { svc, docs } = setup()
    await svc.ingest({
      scope: 'global', platform: 'instagram',
      sourceType: 'global_framework', title: 'Hook framework', text: 'open with a question',
    })
    const q = await new FakeEmbedder().embed('open with a question')
    const results = docs.searchSemantic({
      workspaceId: 'workspace-a', platform: 'instagram', queryEmbedding: q,
    })
    expect(results.some((r) => r.scope === 'global')).toBe(true)
  })
})
