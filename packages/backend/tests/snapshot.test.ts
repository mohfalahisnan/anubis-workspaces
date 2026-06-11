import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ImportSnapshotResult, ProjectSnapshot } from '@anubis/shared'

let dataDir: string

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'anubis-snapshot-'))
  process.env.ANUBIS_DATA_DIR = dataDir
})

afterAll(async () => {
  const { shutdownStack } = await import('../src/services.js')
  await shutdownStack()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('snapshot export', () => {
  it('exports a project\'s competitors and their posts, tagged by handle', async () => {
    const { getStack } = await import('../src/services.js')
    const { buildSnapshot } = await import('../src/snapshot.js')
    const stack = getStack()

    const comp = stack.competitors.create({ handle: '@alpha', displayName: 'Alpha' })
    stack.capturedPosts.upsertMany([
      {
        id: 'p1', competitorId: comp.id, username: 'alpha',
        postUrl: 'https://instagram.com/p/AAA/', likes: 10, capturedAt: 1,
      },
      {
        id: 'p2', competitorId: comp.id, username: 'alpha',
        postUrl: 'https://instagram.com/p/BBB/', likes: 20, capturedAt: 2,
      },
    ])

    const snap: ProjectSnapshot = buildSnapshot('default')
    expect(snap.kind).toBe('anubis-project-snapshot')
    expect(snap.schemaVersion).toBe(1)
    expect(snap.competitors.map((c) => c.handle)).toContain('@alpha')
    expect(snap.capturedPosts).toHaveLength(2)
    expect(snap.capturedPosts.every((p) => p.competitorHandle === '@alpha')).toBe(true)
    // The repo normalises post URLs on upsert (trailing slash stripped), so the
    // exported URLs come back without the trailing slash.
    expect(new Set(snap.capturedPosts.map((p) => p.postUrl))).toEqual(
      new Set(['https://instagram.com/p/AAA', 'https://instagram.com/p/BBB']),
    )
  })

  it('returns 404 for an unknown project via the route', async () => {
    const { default: app } = await import('../src/app.js')
    const res = await app.request('/snapshot/export?projectId=does-not-exist')
    expect(res.status).toBe(404)
  })
})

function sampleSnapshot(): ProjectSnapshot {
  return {
    kind: 'anubis-project-snapshot',
    schemaVersion: 1,
    exportedAt: 123,
    app: { name: 'anubis', version: 'test' },
    project: { id: 'default', name: 'Default Project' },
    competitors: [
      { handle: '@roundtrip', displayName: 'RT', followers: 100 },
    ],
    capturedPosts: [
      { competitorHandle: '@roundtrip', username: 'rt', postUrl: 'https://instagram.com/p/RT1/', likes: 5 },
      { competitorHandle: '@roundtrip', username: 'rt', postUrl: 'https://instagram.com/p/RT2/', likes: 6 },
    ],
  }
}

describe('snapshot import', () => {
  it('round-trips: creates the competitor and its posts', async () => {
    const { getStack } = await import('../src/services.js')
    const { importSnapshot } = await import('../src/snapshot.js')
    const stack = getStack()

    const res = importSnapshot('default', sampleSnapshot())
    expect(res.competitors).toEqual({ created: 1, matched: 0 })
    expect(res.posts.imported).toBe(2)
    expect(res.posts.skipped).toBe(0)
    expect(res.warnings).toEqual([])

    const comp = stack.competitors.list('default').find((c) => c.handle === '@roundtrip')
    expect(comp).toBeTruthy()
    expect(stack.capturedPosts.countForCompetitor(comp!.id)).toBe(2)
    expect(comp!.postCount).toBe(2)
  })

  it('is idempotent: re-importing the same file adds nothing new', async () => {
    const { importSnapshot } = await import('../src/snapshot.js')
    const res = importSnapshot('default', sampleSnapshot())
    expect(res.competitors.created).toBe(0)
    expect(res.competitors.matched).toBe(1)
    expect(res.posts.imported).toBe(0)
    expect(res.posts.skipped).toBe(2)
  })

  it('matches an existing competitor by handle without duplicating', async () => {
    const { getStack } = await import('../src/services.js')
    const { importSnapshot } = await import('../src/snapshot.js')
    const stack = getStack()

    const before = stack.competitors.list().filter((c) => c.handle === '@roundtrip').length
    importSnapshot('default', sampleSnapshot())
    const after = stack.competitors.list().filter((c) => c.handle === '@roundtrip').length
    expect(after).toBe(before) // still exactly one
  })

  it('skips posts whose competitor handle is unknown, with a warning', async () => {
    const { importSnapshot } = await import('../src/snapshot.js')
    // Reference a handle that exists in neither the snapshot nor the DB, so the
    // posts are genuinely orphaned (do NOT reuse @roundtrip — it exists by now).
    const snap: ProjectSnapshot = {
      kind: 'anubis-project-snapshot',
      schemaVersion: 1,
      exportedAt: 1,
      app: { name: 'anubis', version: 'test' },
      project: { id: 'default', name: 'Default Project' },
      competitors: [],
      capturedPosts: [
        { competitorHandle: '@ghost-xyz', username: 'g', postUrl: 'https://instagram.com/p/G1/' },
        { competitorHandle: '@ghost-xyz', username: 'g', postUrl: 'https://instagram.com/p/G2/' },
      ],
    }
    const res = importSnapshot('default', snap)
    expect(res.posts.imported).toBe(0)
    expect(res.warnings.length).toBe(1)
    expect(res.warnings[0]).toMatch(/2 post/)
  })

  it('rejects a wrong-kind file with 400 via the route', async () => {
    const { default: app } = await import('../src/app.js')
    const res = await app.request('/snapshot/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ snapshot: { kind: 'something-else', schemaVersion: 1, competitors: [], capturedPosts: [] } }),
    })
    expect(res.status).toBe(400)
  })

  it('imports via the route and returns the summary', async () => {
    const { default: app } = await import('../src/app.js')
    const snap = sampleSnapshot()
    snap.competitors = [{ handle: '@viaroute' }]
    snap.capturedPosts = [{ competitorHandle: '@viaroute', username: 'vr', postUrl: 'https://instagram.com/p/VR1/' }]
    const res = await app.request('/snapshot/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'default', snapshot: snap }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as ImportSnapshotResult
    expect(body.competitors.created).toBe(1)
    expect(body.posts.imported).toBe(1)
  })
})
