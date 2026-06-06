import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { freshDb } from './helpers/db.js'
import { BrandWorkspacesRepo } from '../src/db/repositories/brand-workspaces-repo.js'
import { AgentRunsRepo } from '../src/db/repositories/agent-runs-repo.js'
import { AgentRunService } from '../src/agent-runs/agent-run-service.js'

const here = dirname(fileURLToPath(import.meta.url))
const sqlFor = (f: string) => readFileSync(join(here, '../src/db/migrations', f), 'utf8')
const migrations = [
  { version: 8, sql: sqlFor('008_brand_workspaces.sql') },
  { version: 15, sql: sqlFor('015_agent_runs.sql') },
]

function setup() {
  const db = freshDb(migrations)
  new BrandWorkspacesRepo(db).insert({ id: 'ws-a', name: 'A', brandSummary: null, toneOfVoice: [],
    audience: [], offers: [], constraints: [], status: 'active', createdAt: 1, updatedAt: 1 })
  const repo = new AgentRunsRepo(db)
  return { repo, svc: new AgentRunService(repo) }
}

describe('AgentRunService.saveRun', () => {
  it('persists a run trace with retrieved id arrays round-tripped', () => {
    const { svc, repo } = setup()
    const run = svc.saveRun({
      workspaceId: 'ws-a', platform: 'instagram', agentId: 'agent-1',
      taskType: 'generate_content', userInput: 'make a post', intent: 'generate',
      output: 'the post', validationStatus: 'passed',
      retrievedChunkIds: ['c1', 'c2'],
      retrievedSimilarityItemIds: ['s1'],
      contextPackId: 'pack-1',
    })
    const got = repo.findById(run.id)
    expect(got?.validationStatus).toBe('passed')
    expect(got?.retrievedChunkIds).toEqual(['c1', 'c2'])
    expect(got?.retrievedSimilarityItemIds).toEqual(['s1'])
    expect(got?.contextPackId).toBe('pack-1')
  })

  it('lists runs for a workspace most-recent first', () => {
    const { svc, repo } = setup()
    svc.saveRun({ workspaceId: 'ws-a', agentId: 'a', taskType: 'generate_content',
      userInput: 'u', intent: 'i', output: 'o', validationStatus: 'passed' }, 100)
    svc.saveRun({ workspaceId: 'ws-a', agentId: 'a', taskType: 'generate_content',
      userInput: 'u', intent: 'i', output: 'o', validationStatus: 'failed' }, 200)
    const runs = repo.listForWorkspace('ws-a')
    expect(runs[0]!.validationStatus).toBe('failed')
  })

  it('listForWorkspace on the service returns runs most-recent first', () => {
    const { svc } = setup()
    svc.saveRun({ workspaceId: 'ws-a', agentId: 'a', taskType: 'generate_content',
      userInput: 'u', intent: 'i', output: 'o', validationStatus: 'passed' }, 100)
    svc.saveRun({ workspaceId: 'ws-a', agentId: 'a', taskType: 'generate_content',
      userInput: 'u', intent: 'i', output: 'o', validationStatus: 'failed' }, 200)
    const runs = svc.listForWorkspace('ws-a')
    expect(runs[0]!.validationStatus).toBe('failed')
    expect(runs).toHaveLength(2)
  })
})
