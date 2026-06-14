import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { ContentPipelineHistoryRepo } from '../../src/db/repositories/content-pipeline-history-repo.js'

function openMigratedDb() {
  const db = openDatabase(':memory:')
  runMigrations(db, MIGRATIONS)
  return db
}

describe('ContentPipelineHistoryRepo', () => {
  it('appends snapshots and lists them chronologically', () => {
    const repo = new ContentPipelineHistoryRepo(openMigratedDb())
    repo.append({ contentId: 'c1', iteration: 0, step: 'breakdown', data: { coreIdea: 'v1' }, profileId: 'p', agent: 'claude' })
    repo.append({ contentId: 'c1', iteration: 1, step: 'breakdown', data: { coreIdea: 'v2' }, profileId: 'p2', agent: 'codex' })
    repo.append({ contentId: 'other', iteration: 0, step: 'refine', data: { caption: 'x' } })

    const list = repo.listByContent('c1')
    expect(list).toHaveLength(2)
    expect(list.map((e) => (e.data as { coreIdea: string }).coreIdea)).toEqual(['v1', 'v2'])
    expect(list[1]).toMatchObject({ iteration: 1, step: 'breakdown', profileId: 'p2', agent: 'codex' })
  })

  it('preserves every iteration instead of overwriting (history, not latest-only)', () => {
    const repo = new ContentPipelineHistoryRepo(openMigratedDb())
    for (let i = 0; i < 3; i++) {
      repo.append({ contentId: 'c1', iteration: i, step: 'ai_review', data: { decision: i === 2 ? 'approved' : 'rejected' } })
    }
    const list = repo.listByContent('c1')
    expect(list).toHaveLength(3)
    expect((list[2].data as { decision: string }).decision).toBe('approved')
  })

  it('round-trips deterministic/human steps without a profile or agent', () => {
    const repo = new ContentPipelineHistoryRepo(openMigratedDb())
    repo.append({ contentId: 'c1', iteration: 0, step: 'human_review', data: { decision: 'approved', reviewedAt: 1 } })
    const [entry] = repo.listByContent('c1')
    expect(entry.profileId).toBeUndefined()
    expect(entry.agent).toBeUndefined()
    expect(entry.step).toBe('human_review')
  })
})
