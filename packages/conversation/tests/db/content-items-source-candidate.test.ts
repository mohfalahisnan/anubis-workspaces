import { afterEach, describe, expect, it } from 'vitest'
import type { ContentItemStatus } from '@anubis/shared'
import { openDatabase } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { ContentItemsRepo } from '../../src/db/repositories/content-items-repo.js'
import { createTestDocuments } from '../helpers/documents.js'

describe('ContentItemsRepo new statuses + sourceCandidateId', () => {
  const cleanups: Array<() => void> = []
  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

  function makeRepo() {
    const db = openDatabase(':memory:')
    runMigrations(db, MIGRATIONS)
    const ctx = createTestDocuments(db)
    cleanups.push(() => { db.close(); ctx.cleanup() })
    return new ContentItemsRepo(db, ctx.documents)
  }

  it('round-trips a raw_extracted status and a source candidate id', () => {
    const repo = makeRepo()
    const created = repo.create({
      id: 'content-c1', projectId: 'default', referenceUrl: 'https://x', title: 'T',
      status: 'raw_extracted' as ContentItemStatus, sourceCandidateId: 'cand-9', now: Date.now(),
    })
    expect(created.status).toBe('raw_extracted')
    expect(created.sourceCandidateId).toBe('cand-9')
    const reloaded = repo.findByIdOrThrow('content-c1')
    expect(reloaded.status).toBe('raw_extracted')
    expect(reloaded.sourceCandidateId).toBe('cand-9')
  })
})
