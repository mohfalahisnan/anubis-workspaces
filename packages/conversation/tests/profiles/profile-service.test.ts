import { describe, it, expect, beforeEach } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, type Db } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { ProfilesRepo } from '../../src/db/repositories/profiles-repo.js'
import { ProfileService } from '../../src/profiles/profile-service.js'
import { CREDENTIAL_FILE } from '../../src/profiles/agent-home.js'
import { ProfileHomeRegistry } from '../../src/profiles/profile-home.js'

describe('ProfileService', () => {
  let db: Db
  let svc: ProfileService

  function mkSvc(agentHomeRoot: string): ProfileService {
    const s = new ProfileService(new ProfilesRepo(db), new ProfileHomeRegistry(agentHomeRoot))
    s.seedBuiltins()
    return s
  }

  beforeEach(() => {
    db = openDatabase(':memory:')
    runMigrations(db, MIGRATIONS)
    // Default svc for tests that don't touch profile homes — agentHomeRoot
    // never read in those paths.
    svc = new ProfileService(new ProfilesRepo(db), new ProfileHomeRegistry('/tmp/unused-anubis-test-root'))
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

  describe('bootstrapDefaultClaudeProfile', () => {
    it('copies system creds into the default profile home when empty', () => {
      const root = mkdtempSync(join(tmpdir(), 'anubis-bootstrap-'))
      const sys = mkdtempSync(join(tmpdir(), 'anubis-bootstrap-sys-'))
      writeFileSync(join(sys, CREDENTIAL_FILE.claude), '{"t":"yes"}')
      const r = mkSvc(root).bootstrapDefaultClaudeProfile({ systemSource: sys })
      expect(r.copied).toBe(true)
      expect(existsSync(join(root, 'claude-coding', 'claude', CREDENTIAL_FILE.claude))).toBe(true)
    })

    it('no-ops when system creds are missing', () => {
      const root = mkdtempSync(join(tmpdir(), 'anubis-bootstrap-'))
      const r = mkSvc(root).bootstrapDefaultClaudeProfile({
        systemSource: join(root, 'no-such-dir'),
      })
      expect(r.copied).toBe(false)
    })

    it('no-ops when the profile home already has credentials', () => {
      const root = mkdtempSync(join(tmpdir(), 'anubis-bootstrap-'))
      const sys = mkdtempSync(join(tmpdir(), 'anubis-bootstrap-sys-'))
      writeFileSync(join(sys, CREDENTIAL_FILE.claude), '{"t":"new"}')
      const dest = join(root, 'claude-coding', 'claude')
      mkdirSync(dest, { recursive: true })
      writeFileSync(join(dest, CREDENTIAL_FILE.claude), '{"t":"old"}')
      const r = mkSvc(root).bootstrapDefaultClaudeProfile({ systemSource: sys })
      expect(r.copied).toBe(false)
    })
  })

  describe('copyProfile', () => {
    it('creates a new profile with the same config', () => {
      const root = mkdtempSync(join(tmpdir(), 'anubis-copy-'))
      const s = mkSvc(root)
      const src = s.create({
        name: 'Source',
        config: { agent: 'claude', model: 'claude-sonnet-4-6' },
      })
      const copied = s.copyProfile(src.id, { name: 'Source (copy)' })
      expect(copied.id).not.toBe(src.id)
      expect(copied.name).toBe('Source (copy)')
      expect(copied.config.agent).toBe('claude')
      expect(copied.config.model).toBe('claude-sonnet-4-6')
    })

    it('copies the source profile home (auth files)', () => {
      const root = mkdtempSync(join(tmpdir(), 'anubis-copy-'))
      const s = mkSvc(root)
      const src = s.create({
        name: 'Source',
        config: { agent: 'claude' },
      })
      const srcHome = join(root, src.id, 'claude')
      mkdirSync(srcHome, { recursive: true })
      writeFileSync(join(srcHome, CREDENTIAL_FILE.claude), '{"t":"yes"}')

      const copied = s.copyProfile(src.id, { name: 'Source (copy)' })
      expect(existsSync(join(root, copied.id, 'claude', CREDENTIAL_FILE.claude))).toBe(true)
    })

    it('throws when the source profile does not exist', () => {
      const root = mkdtempSync(join(tmpdir(), 'anubis-copy-'))
      expect(() => mkSvc(root).copyProfile('nonexistent', { name: 'X' }))
        .toThrow(/not found/)
    })
  })
})
