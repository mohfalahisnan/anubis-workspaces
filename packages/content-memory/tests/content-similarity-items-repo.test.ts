import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { freshDb } from './helpers/db.js'
import { BrandWorkspacesRepo } from '../src/db/repositories/brand-workspaces-repo.js'
import {
  ContentSimilarityItemsRepo,
  type ContentSimilarityItem,
} from '../src/db/repositories/content-similarity-items-repo.js'

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
  const workspaces = new BrandWorkspacesRepo(db)
  for (const id of ['workspace-a', 'workspace-b']) {
    workspaces.insert({
      id, name: id, brandSummary: null,
      toneOfVoice: [], audience: [], offers: [], constraints: [],
      status: 'active', createdAt: 100, updatedAt: 100,
    })
  }
  return new ContentSimilarityItemsRepo(db)
}

function item(over: Partial<ContentSimilarityItem>): ContentSimilarityItem {
  return {
    id: over.id ?? `i-${Math.random().toString(36).slice(2)}`,
    workspaceId: over.workspaceId ?? 'workspace-a',
    platform: over.platform ?? 'instagram',
    contentId: over.contentId ?? null,
    contentType: over.contentType ?? 'competitor_post',
    caption: over.caption ?? null,
    transcript: over.transcript ?? null,
    ocrText: over.ocrText ?? null,
    visualDescription: over.visualDescription ?? null,
    normalizedText: over.normalizedText ?? 'text',
    embedding: over.embedding ?? Float32Array.from([1, 0, 0, 0]),
    performanceScore: over.performanceScore ?? null,
    engagementScore: over.engagementScore ?? null,
    brandFitScore: over.brandFitScore ?? null,
    approvalStatus: over.approvalStatus ?? null,
    rejectionReason: over.rejectionReason ?? null,
    createdAt: over.createdAt ?? 100,
    updatedAt: over.updatedAt ?? 100,
  }
}

describe('ContentSimilarityItemsRepo', () => {
  it('round-trips an item including its embedding', () => {
    const repo = setup()
    repo.upsert(item({ id: 'x1', embedding: Float32Array.from([0.5, 0.5, 0.5, 0.5]) }))
    const got = repo.search({
      workspaceId: 'workspace-a', platform: 'instagram',
      queryEmbedding: Float32Array.from([0.5, 0.5, 0.5, 0.5]),
    })
    expect(got[0]?.id).toBe('x1')
    expect(Array.from(got[0]!.embedding)).toHaveLength(4)
  })

  it('never returns items from another workspace (scope before rank)', () => {
    const repo = setup()
    repo.upsert(item({ workspaceId: 'workspace-a', embedding: Float32Array.from([1, 0, 0, 0]) }))
    repo.upsert(item({ workspaceId: 'workspace-b', embedding: Float32Array.from([1, 0, 0, 0]) }))
    const results = repo.search({
      workspaceId: 'workspace-a', platform: 'instagram',
      queryEmbedding: Float32Array.from([1, 0, 0, 0]),
    })
    expect(results.every((r) => r.workspaceId === 'workspace-a')).toBe(true)
  })

  it('ranks by cosine similarity to the query', () => {
    const repo = setup()
    repo.upsert(item({ id: 'near', embedding: Float32Array.from([1, 0, 0, 0]) }))
    repo.upsert(item({ id: 'far', embedding: Float32Array.from([0, 1, 0, 0]) }))
    const results = repo.search({
      workspaceId: 'workspace-a', platform: 'instagram',
      queryEmbedding: Float32Array.from([1, 0, 0, 0]),
    })
    expect(results.map((r) => r.id)).toEqual(['near', 'far'])
  })

  it('filters by content type and platform', () => {
    const repo = setup()
    repo.upsert(item({ id: 'comp', contentType: 'competitor_post' }))
    repo.upsert(item({ id: 'rej', contentType: 'rejected_post' }))
    repo.upsert(item({ id: 'tiktok', platform: 'tiktok', contentType: 'competitor_post' }))
    const results = repo.search({
      workspaceId: 'workspace-a', platform: 'instagram',
      queryEmbedding: Float32Array.from([1, 0, 0, 0]),
      contentTypes: ['rejected_post'],
    })
    expect(results.map((r) => r.id)).toEqual(['rej'])
  })

  it('upserts by (workspaceId, contentId) keeping the original id', () => {
    const repo = setup()
    repo.upsert(item({ id: 'first', contentId: 'post-1', normalizedText: 'v1' }))
    repo.upsert(item({ id: 'second', contentId: 'post-1', normalizedText: 'v2' }))
    const results = repo.search({
      workspaceId: 'workspace-a', platform: 'instagram',
      queryEmbedding: Float32Array.from([1, 0, 0, 0]),
    })
    expect(results).toHaveLength(1)
    expect(results[0]!.id).toBe('first')
    expect(results[0]!.normalizedText).toBe('v2')
  })
})
