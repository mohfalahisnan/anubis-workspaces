import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase, type Db } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { ProfilesRepo } from '../../src/db/repositories/profiles-repo.js'
import { ProfileService } from '../../src/profiles/profile-service.js'

describe('ProfileService', () => {
  let db: Db
  let svc: ProfileService

  beforeEach(() => {
    db = openDatabase(':memory:')
    runMigrations(db, MIGRATIONS)
    svc = new ProfileService(new ProfilesRepo(db))
    svc.seedBuiltins()
  })

  it('seedBuiltins is idempotent', () => {
    const first = svc.list().length
    svc.seedBuiltins()
    expect(svc.list().length).toBe(first)
  })

  it('list contains the 5 seed profiles', () => {
    const ids = svc.list().map(p => p.id)
    for (const id of ['claude-coding', 'claude-yolo', 'claude-research', 'codex-coding', 'codex-yolo']) {
      expect(ids).toContain(id)
    }
  })

  it('create user profile works', () => {
    const p = svc.create({ name: 'X', config: { agent: 'claude' } })
    expect(p.source).toBe('user')
    expect(svc.get(p.id)).not.toBeNull()
  })

  it('resolve(profileId) deep-merges base config + override patch + per-call override', () => {
    svc.setOverride('claude-coding', { model: 'claude-haiku-4-5' })
    const r = svc.resolve('claude-coding', { permissionMode: 'acceptEdits' })
    expect(r.agent).toBe('claude')
    expect(r.model).toBe('claude-haiku-4-5')
    expect(r.permissionMode).toBe('acceptEdits')
  })

  it('resolve(null, override) uses defaults + override only', () => {
    const r = svc.resolve(null, { agent: 'codex' })
    expect(r.agent).toBe('codex')
  })

  it('resolve throws when no agent can be determined', () => {
    expect(() => svc.resolve(null, {})).toThrow(/agent/i)
  })

  it('delete user profile removes it', () => {
    const p = svc.create({ name: 'mine', config: { agent: 'claude' } })
    svc.delete(p.id)
    expect(svc.get(p.id)).toBeNull()
  })

  it('delete builtin profile clears its override but keeps the row', () => {
    svc.setOverride('claude-coding', { model: 'claude-haiku-4-5' })
    svc.delete('claude-coding')
    const p = svc.get('claude-coding')!
    expect(p).not.toBeNull()
    expect(p.config.model).toBe('claude-sonnet-4-6')
  })
})
