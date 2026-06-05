import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { freshDb } from './helpers/db.js'
import { BrandWorkspacesRepo } from '../src/db/repositories/brand-workspaces-repo.js'
import { ContentContextPacksRepo } from '../src/db/repositories/content-context-packs-repo.js'

const here = dirname(fileURLToPath(import.meta.url))
const sqlFor = (f: string) => readFileSync(join(here, '../src/db/migrations', f), 'utf8')
const migrations = [
  { version: 8, sql: sqlFor('008_brand_workspaces.sql') },
  { version: 13, sql: sqlFor('013_content_context_packs.sql') },
]

function setup() {
  const db = freshDb(migrations)
  new BrandWorkspacesRepo(db).insert({
    id: 'workspace-a', name: 'A', brandSummary: null,
    toneOfVoice: [], audience: [], offers: [], constraints: [],
    status: 'active', createdAt: 100, updatedAt: 100,
  })
  return new ContentContextPacksRepo(db)
}

describe('ContentContextPacksRepo', () => {
  it('saves and reads a pack record with its JSON payload', () => {
    const repo = setup()
    repo.save({
      id: 'pack-1', workspaceId: 'workspace-a', platform: 'instagram',
      campaignId: null, taskType: 'generate_content',
      objective: 'post', query: 'skincare',
      contextJson: { hello: 'world' }, tokenCount: 42, createdAt: 100,
    })
    const got = repo.findById('pack-1')
    expect(got?.tokenCount).toBe(42)
    expect((got?.contextJson as { hello: string }).hello).toBe('world')
  })
})
