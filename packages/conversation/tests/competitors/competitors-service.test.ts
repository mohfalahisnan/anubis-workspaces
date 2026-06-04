import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase, type Db } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { CompetitorsRepo } from '../../src/db/repositories/competitors-repo.js'
import { CompetitorsService } from '../../src/competitors/competitors-service.js'

describe('CompetitorsService', () => {
  let db: Db
  let svc: CompetitorsService

  beforeEach(() => {
    db = openDatabase(':memory:')
    runMigrations(db, MIGRATIONS)
    svc = new CompetitorsService(new CompetitorsRepo(db))
  })

  it('create normalises the handle and assigns a default tint', () => {
    const c = svc.create({ handle: 'ali.abdaal' })
    expect(c.handle).toBe('@ali.abdaal')
    expect(c.tint).toMatch(/^#[0-9A-F]{6}$/i)
    expect(c.postCount).toBe(0)
  })

  it('create rejects a duplicate handle (case sensitive)', () => {
    svc.create({ handle: '@kayla.studio' })
    expect(() => svc.create({ handle: '@kayla.studio' })).toThrow(/already/i)
  })

  it('list returns most-recently-added first', () => {
    const first = svc.create({ handle: '@first' })
    // ensure a different addedAt
    const wait = Date.now() + 5
    while (Date.now() < wait) { /* spin */ }
    const second = svc.create({ handle: '@second' })
    const list = svc.list()
    expect(list.map(c => c.id)).toEqual([second.id, first.id])
  })

  it('update merges patch fields', () => {
    const c = svc.create({ handle: '@notion' })
    const next = svc.update(c.id, { displayName: 'Notion', niche: 'Tooling', followers: 1_600_000 })
    expect(next.displayName).toBe('Notion')
    expect(next.niche).toBe('Tooling')
    expect(next.followers).toBe(1_600_000)
    expect(next.handle).toBe('@notion') // immutable through update
  })

  it('create round-trips bio and level', () => {
    const c = svc.create({ handle: '@figma', bio: 'Design tools', level: 'red' })
    expect(c.bio).toBe('Design tools')
    expect(c.level).toBe('red')
  })

  it('update sets and preserves bio and level', () => {
    const c = svc.create({ handle: '@canva' })
    const next = svc.update(c.id, { bio: 'Make designs', level: 'green' })
    expect(next.bio).toBe('Make designs')
    expect(next.level).toBe('green')
    // omitting them on a later patch preserves the stored values
    const after = svc.update(c.id, { niche: 'Design' })
    expect(after.bio).toBe('Make designs')
    expect(after.level).toBe('green')
  })

  it('update clears the level override when passed null', () => {
    const c = svc.create({ handle: '@webflow', level: 'yellow' })
    const next = svc.update(c.id, { level: null })
    expect(next.level).toBeUndefined()
  })

  it('remove soft-deletes', () => {
    const c = svc.create({ handle: '@linear' })
    svc.remove(c.id)
    expect(svc.get(c.id)).toBeNull()
    expect(svc.list()).toHaveLength(0)
    // The deleted handle is reusable
    expect(() => svc.create({ handle: '@linear' })).not.toThrow()
  })
})
