import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { importCapturedPosts } from '@/api'

const ORIG_FETCH = global.fetch

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  global.fetch = ORIG_FETCH
})

type ImportInput = Parameters<typeof importCapturedPosts>[0]

function makePosts(n: number): ImportInput {
  const posts = Array.from({ length: n }, (_, i) => ({
    competitorId: 'c1',
    username: 'u',
    postUrl: `https://example.com/p/${i}`,
  }))
  return { posts } as unknown as ImportInput
}

/** Each mocked /posts/import call echoes back importedCount = posts in its body. */
function mockImportEcho(): void {
  vi.mocked(global.fetch).mockImplementation(async (_url, init) => {
    const body = JSON.parse((init as RequestInit).body as string) as { posts: unknown[] }
    return new Response(
      JSON.stringify({ ok: true, importedCount: body.posts.length }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  })
}

function requestSizes(): number[] {
  return vi.mocked(global.fetch).mock.calls.map(
    ([, init]) => (JSON.parse((init as RequestInit).body as string) as { posts: unknown[] }).posts.length,
  )
}

describe('importCapturedPosts batching', () => {
  it('splits a >300 selection into ≤300-item requests and sums importedCount', async () => {
    mockImportEcho()
    const result = await importCapturedPosts(makePosts(1000))

    const sizes = requestSizes()
    expect(sizes).toEqual([300, 300, 300, 100]) // 1000 -> 4 batches
    expect(Math.max(...sizes)).toBeLessThanOrEqual(300)
    expect(result.importedCount).toBe(1000)
  })

  it('sends a single request at or below the batch size', async () => {
    mockImportEcho()
    await importCapturedPosts(makePosts(300))
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1)
  })

  it('makes no request for an empty selection', async () => {
    mockImportEcho()
    const result = await importCapturedPosts(makePosts(0))
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled()
    expect(result.importedCount).toBe(0)
  })
})
