import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { materializePostAssets, pipelineItemAssetsDir } from '../../src/content-pipeline/assets.js'

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'anubis-assets-'))
}

describe('pipelineItemAssetsDir', () => {
  it('joins data dir / content-pipeline / id / assets', () => {
    expect(pipelineItemAssetsDir('/data', 'c1').replace(/\\/g, '/')).toBe('/data/content-pipeline/c1/assets')
  })
})

describe('materializePostAssets', () => {
  it('downloads all carousel slides as images', async () => {
    const destDir = join(tmp(), 'assets')
    const fetchMedia = vi.fn(async (url: string) => Buffer.from(`bytes:${url}`))
    const transcribe = vi.fn()
    const res = await materializePostAssets(
      { media: { kind: 'carousel', urls: ['https://cdn/a.jpg', 'https://cdn/b.jpg'] }, destDir },
      { fetchMedia, transcribe },
    )
    expect(res.assets.map((a) => a.fileName)).toEqual(['0.jpg', '1.jpg'])
    expect(res.assets.every((a) => a.kind === 'image')).toBe(true)
    expect(res.transcript).toBeUndefined()
    expect(existsSync(join(destDir, '0.jpg'))).toBe(true)
    expect(fetchMedia).toHaveBeenCalledTimes(2)
  })

  it('downloads the video file and transcribes it', async () => {
    const destDir = join(tmp(), 'assets')
    const fetchMedia = vi.fn(async () => Buffer.from('vid'))
    const transcribe = vi.fn(async () => 'spoken words')
    const res = await materializePostAssets(
      { media: { kind: 'video', urls: ['https://cdn/poster.jpg'], videoUrl: 'https://cdn/v.mp4' }, destDir },
      { fetchMedia, transcribe },
    )
    expect(res.assets.map((a) => a.fileName)).toEqual(['0.jpg', 'video.mp4'])
    expect(res.assets.find((a) => a.fileName === 'video.mp4')!.kind).toBe('video')
    expect(transcribe).toHaveBeenCalledWith(join(destDir, 'video.mp4'))
    expect(res.transcript).toBe('spoken words')
  })

  it('tolerates a transcription failure (caption-only fallback)', async () => {
    const destDir = join(tmp(), 'assets')
    const fetchMedia = vi.fn(async () => Buffer.from('vid'))
    const transcribe = vi.fn(async () => { throw new Error('no audio stream') })
    const res = await materializePostAssets(
      { media: { kind: 'video', videoUrl: 'https://cdn/silent.mp4' }, destDir },
      { fetchMedia, transcribe },
    )
    expect(res.transcript).toBeUndefined()
    expect(res.assets.map((a) => a.fileName)).toEqual(['video.mp4'])
  })

  it('reuses already-downloaded assetPaths without fetching', async () => {
    const cache = tmp()
    const a0 = join(cache, '0.jpg')
    const v = join(cache, 'video.mp4')
    writeFileSync(a0, 'x'); writeFileSync(v, 'y')
    const fetchMedia = vi.fn()
    const transcribe = vi.fn(async () => 'words')
    const res = await materializePostAssets(
      {
        media: { kind: 'carousel', urls: ['https://cdn/a.jpg'], videoUrl: 'https://cdn/v.mp4' },
        assetPaths: { absolute: [a0, v], relative: [] },
        destDir: join(tmp(), 'assets'),
      },
      { fetchMedia, transcribe },
    )
    expect(fetchMedia).not.toHaveBeenCalled()
    expect(res.assets.map((a) => `${a.kind}:${a.fileName}`)).toEqual(['image:0.jpg', 'video:video.mp4'])
    expect(res.transcript).toBe('words')
  })

  it('continues past a single failed download', async () => {
    const destDir = join(tmp(), 'assets')
    const fetchMedia = vi.fn(async (url: string) => {
      if (url.includes('bad')) throw new Error('HTTP 403')
      return Buffer.from('ok')
    })
    const res = await materializePostAssets(
      { media: { kind: 'carousel', urls: ['https://cdn/bad.jpg', 'https://cdn/good.jpg'] }, destDir },
      { fetchMedia, transcribe: vi.fn() },
    )
    expect(res.assets.map((a) => a.fileName)).toEqual(['1.jpg'])
  })

  it('returns nothing when there is no media', async () => {
    const res = await materializePostAssets({ destDir: join(tmp(), 'assets') }, { fetchMedia: vi.fn(), transcribe: vi.fn() })
    expect(res.assets).toEqual([])
    expect(res.transcript).toBeUndefined()
  })
})
