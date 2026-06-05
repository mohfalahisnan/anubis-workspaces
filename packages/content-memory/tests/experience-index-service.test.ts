import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { freshDb } from './helpers/db.js'
import { BrandWorkspacesRepo } from '../src/db/repositories/brand-workspaces-repo.js'
import { ExperienceMemoriesRepo } from '../src/db/repositories/experience-memories-repo.js'
import { ExperienceIndexService } from '../src/experience/experience-index-service.js'

const here = dirname(fileURLToPath(import.meta.url))
const sqlFor = (f: string) => readFileSync(join(here, '../src/db/migrations', f), 'utf8')
const migrations = [
  { version: 8, sql: sqlFor('008_brand_workspaces.sql') },
  { version: 14, sql: sqlFor('014_experience_memories.sql') },
]

function setup() {
  const db = freshDb(migrations)
  new BrandWorkspacesRepo(db).insert({
    id: 'workspace-a', name: 'A', brandSummary: null, toneOfVoice: [], audience: [],
    offers: [], constraints: [], status: 'active', createdAt: 100, updatedAt: 100,
  })
  const repo = new ExperienceMemoriesRepo(db)
  return { repo, svc: new ExperienceIndexService(repo) }
}

describe('ExperienceIndexService', () => {
  it('recordCandidate creates a candidate memory', () => {
    const { svc } = setup()
    const m = svc.recordCandidate({
      workspaceId: 'workspace-a', type: 'mistake',
      title: 'Fear hook', problem: 'used fear', correction: 'use soft hook',
    })
    expect(m.status).toBe('candidate')
    expect(m.severity).toBe('medium')   // default
  })

  it('saveFeedback with a bad rating creates a candidate mistake', () => {
    const { svc, repo } = setup()
    const m = svc.saveFeedback({
      runId: 'run-1', workspaceId: 'workspace-a', rating: 'bad',
      feedback: 'This brand never uses fear-based hooks.',
    })
    expect(m).not.toBeNull()
    expect(repo.findById(m!.id)?.sourceRunId).toBe('run-1')
    expect(m!.type).toBe('mistake')
  })

  it('saveFeedback with a good rating creates nothing by default', () => {
    const { svc } = setup()
    const m = svc.saveFeedback({
      runId: 'run-2', workspaceId: 'workspace-a', rating: 'good', feedback: 'great',
    })
    expect(m).toBeNull()
  })

  it('promote moves a candidate to active and it then recalls', () => {
    const { svc } = setup()
    const m = svc.recordCandidate({
      workspaceId: 'workspace-a', type: 'workflow_rule',
      title: 'Check hooks', problem: 'p', correction: 'c',
      preventionRule: 'check workspace hook restrictions',
    })
    expect(svc.recallActive({ workspaceId: 'workspace-a', platform: 'instagram' })).toHaveLength(0)
    svc.promote(m.id)
    const active = svc.recallActive({ workspaceId: 'workspace-a', platform: 'instagram' })
    expect(active.map((x) => x.id)).toContain(m.id)
  })
})
