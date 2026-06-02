import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase, type Db } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { ProfilesRepo } from '../../src/db/repositories/profiles-repo.js'
import type { Profile } from '../../src/profiles/types.js'

function seed(): Profile {
  return {
    id: 'p1', name: 'one', source: 'user',
    config: { agent: 'claude' },
    sortOrder: 0, createdAt: 1, updatedAt: 1,
  }
}

describe('ProfilesRepo', () => {
  let db: Db
  let repo: ProfilesRepo
  beforeEach(() => {
    db = openDatabase(':memory:')
    runMigrations(db, MIGRATIONS)
    repo = new ProfilesRepo(db)
  })

  it('upsert + findById round-trip', () => {
    repo.upsert(seed())
    const got = repo.findById('p1')!
    expect(got.name).toBe('one')
    expect(got.config.agent).toBe('claude')
  })

  it('list returns sorted by sortOrder asc then lastUsedAt desc', () => {
    repo.upsert({ ...seed(), id: 'a', sortOrder: 20 })
    repo.upsert({ ...seed(), id: 'b', sortOrder: 10 })
    repo.upsert({ ...seed(), id: 'c', sortOrder: 10, lastUsedAt: 99 })
    expect(repo.list().map(p => p.id)).toEqual(['c', 'b', 'a'])
  })

  it('delete removes the row', () => {
    repo.upsert(seed())
    repo.delete('p1')
    expect(repo.findById('p1')).toBeNull()
  })

  it('setOverride and getOverride round-trip', () => {
    repo.upsert(seed())
    repo.setOverride('p1', { model: 'claude-haiku-4-5' }, undefined)
    expect(repo.getOverride('p1')).toEqual({ patch: { model: 'claude-haiku-4-5' }, sortOrder: null })
  })

  it('touchLastUsed updates lastUsedAt', () => {
    repo.upsert(seed())
    repo.touchLastUsed('p1', 12345)
    expect(repo.findById('p1')!.lastUsedAt).toBe(12345)
  })
})
