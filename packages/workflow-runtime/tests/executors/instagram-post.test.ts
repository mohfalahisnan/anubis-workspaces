import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { instagramPostExecutor } from '../../src/executors/instagram-post.js'
import type { CapturedPost } from '../../src/types.js'

const ORIG_FETCH = global.fetch

function ctxWith(opts: {
  dbGet?: (id: string) => Promise<CapturedPost>
  crawlerCapture?: (url: string) => Promise<CapturedPost>
  writeArtifact?: (runId: string, nodeId: string, ext: string, data: Buffer) => Promise<string>
}) {
  return {
    agent: { run: async () => ({ text: '' }) },
    crawler: { captureProfile: opts.crawlerCapture ?? (async () => ({ id: 'x', mediaUrls: [] })) },
    ocr: { extractFromImage: async () => '' },
    db: { getCapturedPost: opts.dbGet ?? (async () => ({ id: 'x', mediaUrls: [] })) },
    fs: { writeRunArtifact: opts.writeArtifact ?? (async (runId, nodeId, ext) => `/tmp/${runId}/${nodeId}.${ext}`) },
    runId: 'r1',
    signal: new AbortController().signal,
    emit: () => {},
  } as const
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => new TextEncoder().encode(`payload-for-${url}`).buffer,
    headers: new Headers({ 'content-type': 'image/jpeg' }),
  })) as unknown as typeof fetch)
})
afterEach(() => { global.fetch = ORIG_FETCH })

describe('instagramPostExecutor', () => {
  it('reads existing post from db and downloads its media to artifacts (mediaUrls → mediaPaths)', async () => {
    const dbGet = vi.fn().mockResolvedValue({
      id: 'p99',
      caption: 'hi',
      mediaUrls: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'],
      metrics: { likes: 5 },
    })
    const writeArtifact = vi.fn().mockImplementation(async (runId, nodeId) => `/tmp/${runId}/${nodeId}`)

    const out = await instagramPostExecutor.run(
      { nodeId: 'n1', config: { source: 'existing', postId: 'p99' }, upstream: {} },
      ctxWith({ dbGet, writeArtifact }),
    )

    expect(dbGet).toHaveBeenCalledWith('p99')
    expect(writeArtifact).toHaveBeenCalledTimes(2)
    expect(out).toEqual({
      kind: 'instagramPost',
      post: {
        id: 'p99',
        caption: 'hi',
        mediaPaths: ['/tmp/r1/n1-media-0', '/tmp/r1/n1-media-1'],
        metrics: { likes: 5 },
      },
    })
    // The output must NOT carry raw media URLs — those are what bust the
    // Windows 8K command-line limit in downstream AI Agent prompts.
    expect(JSON.stringify(out)).not.toContain('cdn.example.com')
  })

  it('calls crawler.captureProfile for url source and downloads its media', async () => {
    const crawlerCapture = vi.fn().mockResolvedValue({
      id: 'fresh', mediaUrls: ['https://x.example.com/c.png'], caption: 'crawled',
    })
    const writeArtifact = vi.fn().mockResolvedValue('/tmp/saved.png')
    const out = await instagramPostExecutor.run(
      { nodeId: 'n1', config: { source: 'url', url: 'https://instagram.com/x' }, upstream: {} },
      ctxWith({ crawlerCapture, writeArtifact }),
    )
    expect(crawlerCapture).toHaveBeenCalledWith('https://instagram.com/x')
    expect(out.post.mediaPaths).toEqual(['/tmp/saved.png'])
    expect(out.post.caption).toBe('crawled')
  })

  it('records per-media failures without failing the whole node', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4), headers: new Headers({ 'content-type': 'image/jpeg' }) })
      .mockResolvedValueOnce({ ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0), headers: new Headers() }) as unknown as typeof fetch)

    const out = await instagramPostExecutor.run(
      { nodeId: 'n1', config: { source: 'existing', postId: 'p' }, upstream: {} },
      ctxWith({
        dbGet: async () => ({ id: 'p', mediaUrls: ['https://ok.example.com/a.jpg', 'https://forbidden.example.com/b.jpg'] }),
      }),
    )
    expect(out.post.mediaPaths.length).toBe(1)
    expect(out.post.mediaErrors?.length).toBe(1)
    expect(out.post.mediaErrors?.[0]).toContain('forbidden.example.com')
  })

  it('rejects invalid url in source=url', () => {
    expect(() =>
      instagramPostExecutor.validateConfig({ source: 'url', url: 'not-a-url' }),
    ).toThrow()
  })
})
