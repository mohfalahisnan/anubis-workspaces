import { describe, it, expect } from 'vitest'
import {
  BrandWorkspacesRepo,
  ContentSimilarityItemsRepo,
  SimilarityIngestionService,
  type Embedder,
} from '@anubis/content-memory'
import { openDatabase } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { CompetitorsRepo } from '../../src/db/repositories/competitors-repo.js'
import { CapturedPostsRepo } from '../../src/db/repositories/captured-posts-repo.js'
import { CapturedPostsSimilarityIngestor } from '../../src/competitors/similarity-ingestor.js'

// Minimal deterministic embedder (Embedder interface is the only contract).
class TinyEmbedder implements Embedder {
  readonly dim = 8
  async embed(text: string): Promise<Float32Array> {
    const v = new Float32Array(this.dim)
    for (let i = 0; i < text.length; i++) v[i % this.dim] = (v[i % this.dim] ?? 0) + text.charCodeAt(i)
    return v
  }
}

function setup() {
  const db = openDatabase(':memory:')
  runMigrations(db, MIGRATIONS)
  const competitors = new CompetitorsRepo(db)
  const posts = new CapturedPostsRepo(db)
  const items = new ContentSimilarityItemsRepo(db)
  const ingestion = new SimilarityIngestionService(items, new TinyEmbedder())
  const ingestor = new CapturedPostsSimilarityIngestor(db, ingestion)
  return { db, competitors, posts, items, ingestor }
}

describe('CapturedPostsSimilarityIngestor', () => {
  it('ingests captured posts scoped to their brand workspace', async () => {
    const { competitors, posts, items, ingestor } = setup()
    competitors.insert({
      id: 'comp-a', handle: '@a', postCount: 0, addedAt: 1, updatedAt: 1,
      workspaceId: 'default-workspace',
    })
    posts.upsert({
      id: 'p1', competitorId: 'comp-a', username: '@a',
      postUrl: 'https://insta/p1', caption: 'great skincare tips',
      likes: 100, comments: 5, capturedAt: 10,
    })

    const res = await ingestor.ingestForWorkspace('default-workspace')
    expect(res.ingested).toBe(1)

    const q = await new TinyEmbedder().embed('great skincare tips')
    const found = items.search({
      workspaceId: 'default-workspace', platform: 'instagram', queryEmbedding: q,
    })
    expect(found).toHaveLength(1)
    expect(found[0]!.contentId).toBe('p1')
    expect(found[0]!.contentType).toBe('competitor_post')
    expect(found[0]!.engagementScore).toBe(105)
  })

  it('does not ingest posts whose competitor belongs to another workspace', async () => {
    const { db, competitors, posts, ingestor } = setup()
    // workspace-other is a real brand (competitors.workspace_id FK requires it);
    // the ingestor must still ignore its posts when ingesting default-workspace.
    new BrandWorkspacesRepo(db).insert({
      id: 'workspace-other', name: 'Other', brandSummary: null,
      toneOfVoice: [], audience: [], offers: [], constraints: [],
      status: 'active', createdAt: 1, updatedAt: 1,
    })
    competitors.insert({
      id: 'comp-b', handle: '@b', postCount: 0, addedAt: 1, updatedAt: 1,
      workspaceId: 'workspace-other',
    })
    posts.upsert({
      id: 'p2', competitorId: 'comp-b', username: '@b',
      postUrl: 'https://insta/p2', caption: 'other brand', capturedAt: 10,
    })
    // Note: workspace-other has no brand_workspaces row, but the ingestor
    // filters by competitor.workspace_id and should simply find nothing here.
    const res = await ingestor.ingestForWorkspace('default-workspace')
    expect(res.ingested).toBe(0)
  })
})
