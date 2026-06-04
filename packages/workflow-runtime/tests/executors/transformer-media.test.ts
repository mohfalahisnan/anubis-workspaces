import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { transformerMediaExecutor } from '../../src/executors/transformer-media.js'

const ORIG_FETCH = global.fetch

function ctxWith(writeArtifact: (runId: string, nodeId: string, ext: string, data: Buffer) => Promise<string>) {
  return {
    agent: { run: async () => ({ text: '' }) },
    crawler: { captureProfile: async () => ({ id: '', mediaUrls: [] }) },
    ocr: { extractFromImage: async () => '' },
    db: { getCapturedPost: async () => ({ id: '', mediaUrls: [] }) },
    fs: { writeRunArtifact: writeArtifact },
    runId: 'r99',
    signal: new AbortController().signal,
    emit: () => {},
  } as const
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    arrayBuffer: async () => new TextEncoder().encode('PAYLOAD').buffer,
    headers: new Headers({ 'content-type': 'image/jpeg' }),
  })) as unknown as typeof fetch)
})
afterEach(() => { global.fetch = ORIG_FETCH })

describe('transformerMediaExecutor', () => {
  it('downloads config.url and writes a run artifact', async () => {
    const writeArtifact = vi.fn().mockResolvedValue('/tmp/runs/r99/n1.jpg')
    const out = await transformerMediaExecutor.run(
      { nodeId: 'n1', config: { url: 'https://example.com/a.jpg' }, upstream: {} },
      ctxWith(writeArtifact),
    )
    expect(writeArtifact).toHaveBeenCalledWith('r99', 'n1', 'jpg', expect.any(Buffer))
    expect(out).toMatchObject({ kind: 'file', path: '/tmp/runs/r99/n1.jpg', mimeType: 'image/jpeg' })
  })

  it('falls back to first upstream media url', async () => {
    const writeArtifact = vi.fn().mockResolvedValue('/tmp/x')
    await transformerMediaExecutor.run(
      {
        nodeId: 'n1',
        config: {},
        upstream: { n2: { kind: 'instagramPost', post: { mediaUrls: ['https://example.com/b.png'] } } },
      },
      ctxWith(writeArtifact),
    )
    expect(global.fetch).toHaveBeenCalledWith('https://example.com/b.png')
  })

  it('throws when no url available', async () => {
    await expect(
      transformerMediaExecutor.run(
        { nodeId: 'n1', config: {}, upstream: {} },
        ctxWith(async () => ''),
      ),
    ).rejects.toThrow(/no.*url/i)
  })
})
