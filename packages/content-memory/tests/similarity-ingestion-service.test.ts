import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { freshDb } from './helpers/db.js'
import { FakeEmbedder } from './helpers/fake-embedder.js'
import { BrandWorkspacesRepo } from '../src/db/repositories/brand-workspaces-repo.js'
import { ContentSimilarityItemsRepo } from '../src/db/repositories/content-similarity-items-repo.js'
import {
  SimilarityIngestionService,
  normalizeSimilarityText,
} from '../src/similarity/similarity-ingestion-service.js'

const here = dirname(fileURLToPath(import.meta.url))
function sqlFor(file: string): string {
  return readFileSync(join(here, '../src/db/migrations', file), 'utf8')
}
const migrations = [
  { version: 8, sql: sqlFor('008_brand_workspaces.sql') },
  { version: 11, sql: sqlFor('011_content_similarity_items.sql') },
]

function setup() {
  const db = freshDb(migrations)
  new BrandWorkspacesRepo(db).insert({
    id: 'workspace-a', name: 'A', brandSummary: null,
    toneOfVoice: [], audience: [], offers: [], constraints: [],
    status: 'active', createdAt: 100, updatedAt: 100,
  })
  const items = new ContentSimilarityItemsRepo(db)
  const svc = new SimilarityIngestionService(items, new FakeEmbedder())
  return { items, svc }
}

describe('normalizeSimilarityText', () => {
  it('joins present fields and drops empties', () => {
    expect(normalizeSimilarityText({
      caption: 'cap', transcript: '', ocrText: 'ocr', visualDescription: null,
    })).toBe('cap\nocr')
  })
})

describe('SimilarityIngestionService', () => {
  it('embeds and stores an item, retrievable by similarity', async () => {
    const { svc, items } = setup()
    await svc.ingest({
      workspaceId: 'workspace-a', platform: 'instagram',
      contentId: 'post-1', contentType: 'competitor_post',
      caption: 'gentle skincare for sensitive skin',
    })
    const q = await new FakeEmbedder().embed('gentle skincare for sensitive skin')
    const results = items.search({
      workspaceId: 'workspace-a', platform: 'instagram', queryEmbedding: q,
    })
    expect(results).toHaveLength(1)
    expect(results[0]!.contentId).toBe('post-1')
    expect(results[0]!.score).toBeCloseTo(1, 6)
  })

  it('re-ingesting the same contentId updates in place', async () => {
    const { svc, items } = setup()
    await svc.ingest({
      workspaceId: 'workspace-a', platform: 'instagram',
      contentId: 'post-1', contentType: 'competitor_post', caption: 'first',
    })
    await svc.ingest({
      workspaceId: 'workspace-a', platform: 'instagram',
      contentId: 'post-1', contentType: 'competitor_post', caption: 'second',
    })
    const q = await new FakeEmbedder().embed('anything')
    const results = items.search({
      workspaceId: 'workspace-a', platform: 'instagram', queryEmbedding: q,
    })
    expect(results).toHaveLength(1)
    expect(results[0]!.caption).toBe('second')
  })
})
