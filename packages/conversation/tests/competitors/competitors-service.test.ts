import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { openDatabase, type Db } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { CompetitorsRepo } from '../../src/db/repositories/competitors-repo.js'
import { CompetitorsService } from '../../src/competitors/competitors-service.js'
import { createTestDocuments } from '../helpers/documents.js'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import matter from 'gray-matter'
import { DocumentStoreError } from '../../src/documents/document-store.js'

describe('CompetitorsService', () => {
  let db: Db
  let svc: CompetitorsService
  let cleanup: () => void
  let root: string

  beforeEach(() => {
    db = openDatabase(':memory:')
    runMigrations(db, MIGRATIONS)
    const context = createTestDocuments(db)
    root = context.root
    cleanup = context.cleanup
    svc = new CompetitorsService(new CompetitorsRepo(db, context.documents))
  })

  afterEach(() => cleanup())

  it('create normalises the handle and assigns a default tint', () => {
    const c = svc.create({ handle: 'ali.abdaal' })
    expect(c.handle).toBe('@ali.abdaal')
    expect(c.tint).toMatch(/^#[0-9A-F]{6}$/i)
    expect(c.postCount).toBe(0)
  })

  it('create rejects a duplicate handle case-insensitively', () => {
    svc.create({ handle: '@kayla.studio' })
    expect(() => svc.create({ handle: '@KAYLA.STUDIO' })).toThrow(/already/i)
    expect(svc.list().map((c) => c.handle)).toEqual(['@kayla.studio'])
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

  it('defaults platform/status/favorite and round-trips them', () => {
    const c = svc.create({ handle: '@baseliner' })
    expect(c.platform).toBe('instagram')
    expect(c.status).toBe('active')
    expect(c.favorite).toBe(false)

    const next = svc.update(c.id, { favorite: true, status: 'paused', platform: 'tiktok' })
    expect(next.favorite).toBe(true)
    expect(next.status).toBe('paused')
    expect(next.platform).toBe('tiktok')

    // omitting them on a later patch preserves stored values
    const after = svc.update(c.id, { niche: 'Fitness' })
    expect(after.favorite).toBe(true)
    expect(after.status).toBe('paused')
  })

  it('persists baseline fields via setBaseline', () => {
    const c = svc.create({ handle: '@withbaseline' })
    svc.setBaseline(c.id, { baselineLikes: 120, baselineSampleSize: 18, baselineUpdatedAt: 1_700_000_000_000 })
    const got = svc.get(c.id)!
    expect(got.baselineLikes).toBe(120)
    expect(got.baselineSampleSize).toBe(18)
    expect(got.baselineUpdatedAt).toBe(1_700_000_000_000)
  })

  it('reads manual Markdown edits on the next request', () => {
    const created = svc.create({ handle: '@manual-edit' })
    const directory = join(root, 'knowledge', 'competitors')
    const path = join(directory, readdirSync(directory)[0]!)
    const source = readFileSync(path, 'utf8')
    writeFileSync(path, source.replace('niche: null', 'niche: Strategy'), 'utf8')
    expect(svc.get(created.id)?.niche).toBe('Strategy')
  })

  it('reports manually duplicated handles as a document conflict', () => {
    svc.create({ handle: '@first-handle' })
    svc.create({ handle: '@second-handle' })
    const directory = join(root, 'knowledge', 'competitors')
    const secondPath = readdirSync(directory)
      .map((file) => join(directory, file))
      .find((path) => matter(readFileSync(path, 'utf8')).data.handle === '@second-handle')!
    const parsed = matter(readFileSync(secondPath, 'utf8'))
    parsed.data.handle = '@FIRST-HANDLE'
    writeFileSync(secondPath, matter.stringify(parsed.content, parsed.data), 'utf8')

    expect(() => svc.list()).toThrowError(
      expect.objectContaining({
        code: 'DUPLICATE_DOCUMENT_FIELD',
        details: expect.objectContaining({ field: 'handle', paths: expect.any(Array) }),
      }) as DocumentStoreError,
    )
  })
})
