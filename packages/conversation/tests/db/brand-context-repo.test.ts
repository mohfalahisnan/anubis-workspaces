import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { BrandContextRepo } from '../../src/db/repositories/brand-context-repo.js'
import { createTestDocuments } from '../helpers/documents.js'

describe('BrandContextRepo', () => {
  const cleanups: Array<() => void> = []
  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

  function makeRepo() {
    const db = openDatabase(':memory:')
    runMigrations(db, MIGRATIONS)
    const ctx = createTestDocuments(db)
    cleanups.push(() => { db.close(); ctx.cleanup() })
    return new BrandContextRepo(ctx.documents)
  }

  it('returns empty fields for a project with no doc yet', () => {
    const repo = makeRepo()
    const bc = repo.get('default')
    expect(bc.brandGuideline).toBe('')
    expect(bc.toneOfVoice).toBe('')
  })

  it('saves and reloads the structured fields', () => {
    const repo = makeRepo()
    repo.save('default', {
      brandGuideline: 'Be bold', toneOfVoice: 'Playful', targetAudience: 'Founders',
      nichePositioning: 'AI tooling', contentRules: 'No emojis in headlines',
    })
    const bc = repo.get('default')
    expect(bc.brandGuideline).toBe('Be bold')
    expect(bc.contentRules).toBe('No emojis in headlines')
  })
})
