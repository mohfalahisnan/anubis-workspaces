import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { ContentPipelineSettingsRepo } from '../../src/db/repositories/content-pipeline-settings-repo.js'

function openMigratedDb() {
  const db = openDatabase(':memory:')
  runMigrations(db, MIGRATIONS)
  return db
}

describe('ContentPipelineSettingsRepo', () => {
  it('returns empty settings for an unknown project', () => {
    const repo = new ContentPipelineSettingsRepo(openMigratedDb())
    expect(repo.get('p1')).toEqual({ projectId: 'p1', steps: {}, updatedAt: 0 })
  })

  it('persists and round-trips per-step overrides', () => {
    const repo = new ContentPipelineSettingsRepo(openMigratedDb())
    repo.put('p1', {
      brief: { promptTemplate: 'Custom {{source}}', model: 'claude-opus-4-7', maxJsonAttempts: 5 },
      ai_review: { reasoningEffort: 'high', temperature: 0.3 },
    })
    const s = repo.get('p1')
    expect(s.steps.brief).toMatchObject({ promptTemplate: 'Custom {{source}}', model: 'claude-opus-4-7', maxJsonAttempts: 5 })
    expect(s.steps.ai_review).toMatchObject({ reasoningEffort: 'high', temperature: 0.3 })
    expect(s.updatedAt).toBeGreaterThan(0)
  })

  it('replaces (not merges) the step map on put', () => {
    const repo = new ContentPipelineSettingsRepo(openMigratedDb())
    repo.put('p1', { brief: { model: 'a' } })
    repo.put('p1', { refine: { model: 'b' } })
    const s = repo.get('p1')
    expect(s.steps.brief).toBeUndefined()
    expect(s.steps.refine).toMatchObject({ model: 'b' })
  })
})
