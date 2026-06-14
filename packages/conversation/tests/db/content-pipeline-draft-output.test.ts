import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { ContentPipelineRepo } from '../../src/db/repositories/content-pipeline-repo.js'

describe('ContentPipelineRepo draftOutput', () => {
  it('persists and reloads draftOutput JSON', () => {
    const db = openDatabase(':memory:')
    runMigrations(db, MIGRATIONS)
    const repo = new ContentPipelineRepo(db)
    repo.patch('c1', {
      draftOutput: {
        finalCaption: 'cap', finalHashtags: ['#a'], assets: [], sourceRef: {},
        generationMeta: [], reviewHistory: {}, lessonsUsed: [], generationLogs: [], stitchedAt: 5,
      },
    })
    expect(repo.get('c1').draftOutput?.finalCaption).toBe('cap')
  })
})
