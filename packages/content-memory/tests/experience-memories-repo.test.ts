import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { freshDb } from './helpers/db.js'
import { BrandWorkspacesRepo } from '../src/db/repositories/brand-workspaces-repo.js'
import {
  ExperienceMemoriesRepo,
  type ExperienceMemory,
} from '../src/db/repositories/experience-memories-repo.js'

const here = dirname(fileURLToPath(import.meta.url))
const sqlFor = (f: string) => readFileSync(join(here, '../src/db/migrations', f), 'utf8')
const migrations = [
  { version: 8, sql: sqlFor('008_brand_workspaces.sql') },
  { version: 14, sql: sqlFor('014_experience_memories.sql') },
]

function setup() {
  const db = freshDb(migrations)
  const brands = new BrandWorkspacesRepo(db)
  for (const id of ['workspace-a', 'workspace-b']) {
    brands.insert({
      id, name: id, brandSummary: null, toneOfVoice: [], audience: [], offers: [],
      constraints: [], status: 'active', createdAt: 100, updatedAt: 100,
    })
  }
  return new ExperienceMemoriesRepo(db)
}

function mem(over: Partial<ExperienceMemory>): ExperienceMemory {
  return {
    id: over.id ?? `m-${Math.random().toString(36).slice(2)}`,
    scope: over.scope ?? 'workspace',
    workspaceId: over.workspaceId ?? 'workspace-a',
    platform: over.platform ?? null,
    campaignId: over.campaignId ?? null,
    agentId: over.agentId ?? null,
    type: over.type ?? 'mistake',
    title: over.title ?? 'Avoid fear hooks',
    problem: over.problem ?? 'used a fear hook',
    cause: over.cause ?? null,
    correction: over.correction ?? 'use a soft educational hook',
    triggerPattern: over.triggerPattern ?? null,
    preventionRule: over.preventionRule ?? null,
    severity: over.severity ?? 'medium',
    status: over.status ?? 'candidate',
    usageCount: over.usageCount ?? 0,
    successCount: over.successCount ?? 0,
    failureCount: over.failureCount ?? 0,
    confidence: over.confidence ?? 0,
    sourceRunId: over.sourceRunId ?? null,
    sourceDocumentId: over.sourceDocumentId ?? null,
    createdAt: over.createdAt ?? 100,
    updatedAt: over.updatedAt ?? 100,
  }
}

describe('ExperienceMemoriesRepo', () => {
  it('inserts and reads a memory', () => {
    const repo = setup()
    repo.insert(mem({ id: 'm1' }))
    expect(repo.findById('m1')?.title).toBe('Avoid fear hooks')
  })

  it('setStatus promotes a candidate to active', () => {
    const repo = setup()
    repo.insert(mem({ id: 'm1', status: 'candidate' }))
    repo.setStatus('m1', 'active')
    expect(repo.findById('m1')?.status).toBe('active')
  })

  it('recallActive returns active/reinforced for the workspace or global, scoped', () => {
    const repo = setup()
    repo.insert(mem({ id: 'active-a', workspaceId: 'workspace-a', status: 'active' }))
    repo.insert(mem({ id: 'cand-a', workspaceId: 'workspace-a', status: 'candidate' }))
    repo.insert(mem({ id: 'active-b', workspaceId: 'workspace-b', status: 'active' }))
    repo.insert(mem({ id: 'global', scope: 'global', workspaceId: null, status: 'reinforced' }))

    const got = repo.recallActive({ workspaceId: 'workspace-a', platform: 'instagram' })
    const ids = got.map((m) => m.id)
    expect(ids).toContain('active-a')
    expect(ids).toContain('global')
    expect(ids).not.toContain('cand-a')     // candidates excluded
    expect(ids).not.toContain('active-b')   // other workspace excluded
  })

  it('recallActive excludes a TikTok-only memory for an Instagram task', () => {
    const repo = setup()
    repo.insert(mem({ id: 'tt', workspaceId: 'workspace-a', status: 'active', platform: 'tiktok' }))
    const got = repo.recallActive({ workspaceId: 'workspace-a', platform: 'instagram' })
    expect(got.map((m) => m.id)).not.toContain('tt')
  })
})
