import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { ContentPipelineRepo } from '../../src/db/repositories/content-pipeline-repo.js'

function openMigratedDb() {
  const db = openDatabase(':memory:')
  runMigrations(db, MIGRATIONS)
  return db
}

describe('ContentPipelineRepo', () => {
  it('returns a default empty pipeline for an unknown id', () => {
    const repo = new ContentPipelineRepo(openMigratedDb())
    const p = repo.get('c1')
    expect(p).toEqual({ contentId: 'c1', autoIterationCount: 0, updatedAt: 0 })
  })

  it('persists and round-trips structured artifacts as JSON', () => {
    const repo = new ContentPipelineRepo(openMigratedDb())
    repo.patch('c1', {
      rawIdea: { caption: 'hi', assetRefs: ['a.jpg'] },
      improvedBrief: {
        coreIdea: 'x', targetAudience: 'y', marketFit: 'm', problem: 'p',
        mainMessage: 'msg', contentAngle: 'angle', hookDirection: 'hook',
        brandAlignmentNotes: 'bn', toneDirection: 'td', adaptationStrategy: 'as',
        riskNotes: 'rn', referenceLessons: ['l1'],
      },
    })
    const p = repo.get('c1')
    expect(p.rawIdea?.caption).toBe('hi')
    expect(p.improvedBrief?.referenceLessons).toEqual(['l1'])
    expect(p.updatedAt).toBeGreaterThan(0)
  })

  it('increments and resets the auto-iteration counter', () => {
    const repo = new ContentPipelineRepo(openMigratedDb())
    expect(repo.incrementIteration('c1')).toBe(1)
    expect(repo.incrementIteration('c1')).toBe(2)
    repo.resetIteration('c1')
    expect(repo.get('c1').autoIterationCount).toBe(0)
  })
})
