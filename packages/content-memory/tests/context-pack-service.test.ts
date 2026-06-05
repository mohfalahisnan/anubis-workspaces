import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { freshDb } from './helpers/db.js'
import { FakeEmbedder } from './helpers/fake-embedder.js'
import { BrandWorkspacesRepo } from '../src/db/repositories/brand-workspaces-repo.js'
import { KnowledgeDocumentsRepo } from '../src/db/repositories/knowledge-documents-repo.js'
import { ContentSimilarityItemsRepo } from '../src/db/repositories/content-similarity-items-repo.js'
import { SimilarityIngestionService } from '../src/similarity/similarity-ingestion-service.js'
import { ContextPackService } from '../src/context-pack/context-pack-service.js'

const here = dirname(fileURLToPath(import.meta.url))
const sqlFor = (f: string) => readFileSync(join(here, '../src/db/migrations', f), 'utf8')
const migrations = [
  { version: 8, sql: sqlFor('008_brand_workspaces.sql') },
  { version: 9, sql: sqlFor('009_knowledge_documents.sql') },
  { version: 11, sql: sqlFor('011_content_similarity_items.sql') },
  { version: 12, sql: sqlFor('012_knowledge_documents_embedding.sql') },
]

async function setup() {
  const db = freshDb(migrations)
  const brands = new BrandWorkspacesRepo(db)
  brands.insert({
    id: 'workspace-a', name: 'Skincare A', brandSummary: 'Gentle skincare',
    toneOfVoice: ['warm'], audience: ['women 25-40'], offers: ['serum'],
    constraints: ['no fear-based hooks'],
    status: 'active', createdAt: 100, updatedAt: 100,
  })
  const docs = new KnowledgeDocumentsRepo(db)
  const items = new ContentSimilarityItemsRepo(db)
  const embedder = new FakeEmbedder()
  const ingest = new SimilarityIngestionService(items, embedder)
  await ingest.ingest({ workspaceId: 'workspace-a', platform: 'instagram',
    contentId: 'a1', contentType: 'approved_post', caption: 'skincare win', approvalStatus: 'approved' })
  await ingest.ingest({ workspaceId: 'workspace-a', platform: 'instagram',
    contentId: 'c1', contentType: 'competitor_post', caption: 'competitor skincare' })
  await ingest.ingest({ workspaceId: 'workspace-a', platform: 'instagram',
    contentId: 'r1', contentType: 'rejected_post', caption: 'fear-based skincare',
    approvalStatus: 'rejected', rejectionReason: 'used a fear hook' })
  return new ContextPackService({ brands, docs, items, embedder })
}

describe('ContextPackService.buildContentContextPack', () => {
  it('fills brand context from the brand workspace', async () => {
    const svc = await setup()
    const pack = await svc.buildContentContextPack({
      workspaceId: 'workspace-a', platform: 'instagram',
      taskType: 'generate_content', query: 'skincare campaign', objective: 'Generate post',
    })
    expect(pack.brandContext.brandSummary).toBe('Gentle skincare')
    expect(pack.brandContext.constraints).toContain('no fear-based hooks')
    expect(pack.workspaceRules.mustAvoid).toContain('no fear-based hooks')
  })

  it('separates approved, competitor and rejected similar content (spec §22.4)', async () => {
    const svc = await setup()
    const pack = await svc.buildContentContextPack({
      workspaceId: 'workspace-a', platform: 'instagram',
      taskType: 'generate_content', query: 'skincare', objective: 'Generate post',
    })
    expect(pack.similarContent.approved.map((s) => s.id)).toContain('a1')
    expect(pack.similarContent.competitor.map((s) => s.id)).toContain('c1')
    expect(pack.similarContent.rejected.map((s) => s.id)).toContain('r1')
    // Rejected never leaks into approved.
    expect(pack.similarContent.approved.some((s) => s.approvalStatus === 'rejected')).toBe(false)
    expect(pack.similarContent.approved.map((s) => s.id)).not.toContain('r1')
  })

  it('emits citations and a final instruction', async () => {
    const svc = await setup()
    const pack = await svc.buildContentContextPack({
      workspaceId: 'workspace-a', platform: 'instagram',
      taskType: 'generate_content', query: 'skincare', objective: 'Generate post',
    })
    expect(pack.citations.length).toBeGreaterThan(0)
    expect(pack.finalInstruction).toContain('Generate post')
  })

  it('throws for an unknown workspace', async () => {
    const svc = await setup()
    await expect(svc.buildContentContextPack({
      workspaceId: 'nope', platform: 'instagram',
      taskType: 'generate_content', query: 'x', objective: 'y',
    })).rejects.toThrow(/workspace/i)
  })
})
