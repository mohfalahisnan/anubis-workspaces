import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { CapturedPostSummary } from '@anubis/shared'
import { buildRawIdea } from '../../src/content-pipeline/raw-extract.js'

const destDir = () => join(mkdtempSync(join(tmpdir(), 'anubis-raw-')), 'assets')

const imgPost = {
  id: 'p1', competitorId: 'k1', username: 'acme', postUrl: 'https://ig/p/1',
  caption: 'hello', mediaKind: 'image', mediaUrl: 'https://cdn/x.jpg', capturedAt: 1,
  competitorHandle: '@acme',
} as CapturedPostSummary

describe('buildRawIdea', () => {
  it('assembles fields and downloads an image without transcribing', async () => {
    const fetchMedia = vi.fn(async () => Buffer.from('img'))
    const transcribe = vi.fn()
    const raw = await buildRawIdea({
      post: imgPost,
      media: { kind: 'image', urls: ['https://cdn/x.jpg'] },
      destDir: destDir(),
      fetchMedia,
      transcribeMedia: transcribe,
    })
    expect(raw.caption).toBe('hello')
    expect(raw.sourceUrl).toBe('https://ig/p/1')
    expect(raw.mediaKind).toBe('image')
    expect(raw.transcript).toBeUndefined()
    expect(raw.localAssets!.map((a) => a.fileName)).toEqual(['0.jpg'])
    expect(transcribe).not.toHaveBeenCalled()
  })

  it('downloads + transcribes a video post', async () => {
    const fetchMedia = vi.fn(async () => Buffer.from('v'))
    const transcribe = vi.fn(async () => 'spoken words')
    const raw = await buildRawIdea({
      post: { ...imgPost, mediaKind: 'video' },
      media: { kind: 'video', videoUrl: 'https://cdn/v.mp4' },
      destDir: destDir(),
      fetchMedia,
      transcribeMedia: transcribe,
    })
    expect(transcribe).toHaveBeenCalled()
    expect(raw.transcript).toBe('spoken words')
    expect(raw.localAssets!.map((a) => a.kind)).toContain('video')
  })

  it('survives a transcription failure with caption only', async () => {
    const fetchMedia = vi.fn(async () => Buffer.from('v'))
    const transcribe = vi.fn(async () => { throw new Error('no stream') })
    const raw = await buildRawIdea({
      post: { ...imgPost, mediaKind: 'video' },
      media: { kind: 'video', videoUrl: 'https://cdn/silent.mp4' },
      destDir: destDir(),
      fetchMedia,
      transcribeMedia: transcribe,
    })
    expect(raw.transcript).toBeUndefined()
    expect(raw.caption).toBe('hello')
  })

  it('falls back to referenceUrl when there is no post', async () => {
    const raw = await buildRawIdea({
      referenceUrl: 'https://ig/p/9',
      destDir: destDir(),
      fetchMedia: vi.fn(),
      transcribeMedia: vi.fn(),
    })
    expect(raw.sourceUrl).toBe('https://ig/p/9')
    expect(raw.assetRefs).toEqual([])
    expect(raw.localAssets ?? []).toEqual([])
  })
})
