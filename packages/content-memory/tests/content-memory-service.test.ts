import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { freshDb } from './helpers/db.js'
import { FakeEmbedder } from './helpers/fake-embedder.js'
import { BrandWorkspacesRepo } from '../src/db/repositories/brand-workspaces-repo.js'
import { KnowledgeDocumentsRepo } from '../src/db/repositories/knowledge-documents-repo.js'
import { ContentSimilarityItemsRepo } from '../src/db/repositories/content-similarity-items-repo.js'
import { ContentContextPacksRepo } from '../src/db/repositories/content-context-packs-repo.js'
import { ContextPackService } from '../src/context-pack/context-pack-service.js'
import { ContentMemoryService } from '../src/service.js'

const here = dirname(fileURLToPath(import.meta.url))
const sqlFor = (f: string) => readFileSync(join(here, '../src/db/migrations', f), 'utf8')
const migrations = [8, 9, 11, 12, 13].map((v) => ({
  version: v,
  sql: sqlFor(
    { 8: '008_brand_workspaces.sql', 9: '009_knowledge_documents.sql',
      11: '011_content_similarity_items.sql', 12: '012_knowledge_documents_embedding.sql',
      13: '013_content_context_packs.sql' }[v as 8 | 9 | 11 | 12 | 13],
  ),
}))

function setup() {
  const db = freshDb(migrations)
  const brands = new BrandWorkspacesRepo(db)
  brands.insert({
    id: 'workspace-a', name: 'A', brandSummary: 'B',
    toneOfVoice: [], audience: [], offers: [], constraints: [],
    status: 'active', createdAt: 100, updatedAt: 100,
  })
  const embedder = new FakeEmbedder()
  const contextPack = new ContextPackService({
    brands, docs: new KnowledgeDocumentsRepo(db),
    items: new ContentSimilarityItemsRepo(db), embedder,
  })
  const packs = new ContentContextPacksRepo(db)
  return { svc: new ContentMemoryService({ contextPack, packs }), packs }
}

describe('ContentMemoryService.buildForContentTask', () => {
  it('builds a pack and persists a record', async () => {
    const { svc, packs } = setup()
    const { pack, packId } = await svc.buildForContentTask({
      workspaceId: 'workspace-a', platform: 'instagram',
      taskType: 'generate_content', query: 'skincare', objective: 'Generate',
    })
    expect(pack.workspaceId).toBe('workspace-a')
    expect(packs.findById(packId)?.taskType).toBe('generate_content')
  })

  it('getPack returns a persisted pack by id', async () => {
    const { svc } = setup()
    const { packId } = await svc.buildForContentTask({
      workspaceId: 'workspace-a', platform: 'instagram',
      taskType: 'generate_content', query: 'skincare', objective: 'Generate',
    })
    const pack = svc.getPack(packId)
    expect(pack?.workspaceId).toBe('workspace-a')
    expect(svc.getPack('nope')).toBeNull()
  })
})
