import { describe, it, expect, vi } from 'vitest'
import { instagramPostExecutor } from '../../src/executors/instagram-post.js'
import type { CapturedPost } from '../../src/types.js'

function ctxWith(opts: { dbGet?: (id: string) => Promise<CapturedPost>; crawlerCapture?: (url: string) => Promise<CapturedPost> }) {
  return {
    agent: { run: async () => ({ text: '' }) },
    crawler: { captureProfile: opts.crawlerCapture ?? (async () => ({ id: 'x', mediaUrls: [] })) },
    ocr: { extractFromImage: async () => '' },
    db: { getCapturedPost: opts.dbGet ?? (async () => ({ id: 'x', mediaUrls: [] })) },
    fs: { writeRunArtifact: async () => '' },
    runId: 'r1',
    signal: new AbortController().signal,
    emit: () => {},
  } as const
}

describe('instagramPostExecutor', () => {
  it('reads existing post from db when source=existing', async () => {
    const dbGet = vi.fn().mockResolvedValue({ id: 'p99', mediaUrls: ['https://a'] })
    const out = await instagramPostExecutor.run(
      { nodeId: 'n1', config: { source: 'existing', postId: 'p99' }, upstream: {} },
      ctxWith({ dbGet }),
    )
    expect(dbGet).toHaveBeenCalledWith('p99')
    expect(out).toEqual({ kind: 'instagramPost', post: { id: 'p99', mediaUrls: ['https://a'] } })
  })

  it('calls crawler.captureProfile when source=url', async () => {
    const crawlerCapture = vi.fn().mockResolvedValue({ id: 'fresh', mediaUrls: ['https://b'] })
    const out = await instagramPostExecutor.run(
      { nodeId: 'n1', config: { source: 'url', url: 'https://instagram.com/x' }, upstream: {} },
      ctxWith({ crawlerCapture }),
    )
    expect(crawlerCapture).toHaveBeenCalledWith('https://instagram.com/x')
    expect(out).toEqual({ kind: 'instagramPost', post: { id: 'fresh', mediaUrls: ['https://b'] } })
  })

  it('rejects invalid url in source=url', () => {
    expect(() =>
      instagramPostExecutor.validateConfig({ source: 'url', url: 'not-a-url' }),
    ).toThrow()
  })
})
