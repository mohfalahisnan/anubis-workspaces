import { describe, it, expect } from 'vitest'
import { openDatabase } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { KnownWorkspacesRepo } from '../../src/db/repositories/known-workspaces-repo.js'

function freshRepo() {
  const db = openDatabase(':memory:')
  runMigrations(db, MIGRATIONS)
  return new KnownWorkspacesRepo(db)
}

describe('KnownWorkspacesRepo', () => {
  it('lists remembered paths most-recent first', () => {
    const repo = freshRepo()
    repo.remember('/a', 100)
    repo.remember('/b', 200)
    const items = repo.list()
    expect(items.map((w) => w.path)).toEqual(['/b', '/a'])
    expect(items[0]!.lastUsedAt).toBe(200)
  })

  it('remember on an existing path bumps recency without duplicating', () => {
    const repo = freshRepo()
    repo.remember('/a', 100)
    repo.remember('/b', 150)
    repo.remember('/a', 300)
    const items = repo.list()
    expect(items.map((w) => w.path)).toEqual(['/a', '/b'])
    expect(items.find((w) => w.path === '/a')!.lastUsedAt).toBe(300)
  })

  it('remove deletes a path', () => {
    const repo = freshRepo()
    repo.remember('/a', 100)
    repo.remember('/b', 200)
    repo.remove('/a')
    expect(repo.list().map((w) => w.path)).toEqual(['/b'])
  })
})
