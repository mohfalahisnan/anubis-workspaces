import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { imageVideoExecutor } from '../../src/executors/image-video.js'

const ORIG_FETCH = global.fetch

function ctx(writeArtifact = async (runId: string, nodeId: string, ext: string) => `/tmp/${runId}/${nodeId}.${ext}`) {
  return {
    agent: { run: async () => ({ text: '' }) },
    crawler: { captureProfile: async () => ({ id: '', mediaUrls: [] }) },
    ocr: { extractFromImage: async () => '' },
    db: { getCapturedPost: async () => ({ id: '', mediaUrls: [] }) },
    fs: { writeRunArtifact: writeArtifact },
    runId: 'r1',
    signal: new AbortController().signal,
    emit: () => {},
  } as const
}

describe('imageVideoExecutor', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode('PNG_BYTES').buffer,
      headers: new Headers({ 'content-type': 'image/png' }),
    })) as unknown as typeof fetch)
  })
  afterEach(() => { global.fetch = ORIG_FETCH })

  it('downloads a URL into an artifact and reports origin=url', async () => {
    const writeArtifact = vi.fn().mockResolvedValue('/tmp/r1/n1.png')
    const out = await imageVideoExecutor.run(
      { nodeId: 'n1', config: { source: 'url', url: 'https://example.com/x.png' }, upstream: {} },
      ctx(writeArtifact),
    )
    expect(writeArtifact).toHaveBeenCalledWith('r1', 'n1', 'png', expect.any(Buffer))
    expect(out).toMatchObject({ kind: 'file', path: '/tmp/r1/n1.png', mimeType: 'image/png', origin: 'url' })
  })

  it('uses a local file path as-is without downloading', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'iv-test-'))
    const localPath = join(tmp, 'photo.jpg')
    await writeFile(localPath, Buffer.from([0xff, 0xd8, 0xff, 0xe0]))

    try {
      const writeArtifact = vi.fn()
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

      const out = await imageVideoExecutor.run(
        { nodeId: 'n1', config: { source: 'local', path: localPath }, upstream: {} },
        ctx(writeArtifact as never),
      )

      expect(fetchMock).not.toHaveBeenCalled()
      expect(writeArtifact).not.toHaveBeenCalled()
      expect(out.kind).toBe('file')
      expect(out.path).toBe(localPath)
      expect(out.origin).toBe('local')
      expect(out.sizeBytes).toBe(4)
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  it('throws a clear error when the local path does not exist', async () => {
    await expect(
      imageVideoExecutor.run(
        { nodeId: 'n1', config: { source: 'local', path: '/this/path/does/not/exist.png' }, upstream: {} },
        ctx(),
      ),
    ).rejects.toThrow(/not readable/i)
  })

  it('rejects config that has neither url nor path filled in', () => {
    expect(() => imageVideoExecutor.validateConfig({ source: 'url', url: 'not-a-url' })).toThrow()
    expect(() => imageVideoExecutor.validateConfig({ source: 'local' })).toThrow()
  })
})
