import { describe, it, expect, afterEach } from 'vitest'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openDatabase } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { ContentItemsRepo } from '../../src/db/repositories/content-items-repo.js'
import { createTestDocuments } from '../helpers/documents.js'

describe('ContentItemsRepo markdown parsing', () => {
  const cleanups: Array<() => void> = []
  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

  function setup() {
    const db = openDatabase(':memory:')
    runMigrations(db, MIGRATIONS)
    const context = createTestDocuments(db)
    cleanups.push(() => { db.close(); context.cleanup() })
    return { ...context, repo: new ContentItemsRepo(db, context.documents) }
  }

  it('accepts an unquoted YAML published_at timestamp from a manual edit', () => {
    const { root, repo } = setup()
    const created = repo.create({
      id: 'content-aaaa1111', projectId: 'default', title: 'Launch post', now: 1_765_000_000_000,
    })

    // Simulate a human editing the file and writing a bare (unquoted) timestamp,
    // which gray-matter/js-yaml parses into a Date rather than a string.
    const dir = join(root, 'knowledge', 'content')
    const file = join(dir, readdirSync(dir).find((name) => name.endsWith('.md'))!)
    const edited = readFileSync(file, 'utf8').replace(
      'published_at: null',
      'published_at: 2026-06-13T10:00:00.000Z',
    )
    writeFileSync(file, edited, 'utf8')

    const item = repo.findById(created.id)
    expect(item?.publishedAt).toBe('2026-06-13T10:00:00.000Z')
  })
})
