import { describe, expect, it, vi } from 'vitest'
import type { CapturedPostSummary } from '@anubis/shared'
import { buildRawIdea } from '../../src/content-pipeline/raw-extract.js'

const imgPost = {
  id: 'p1', competitorId: 'k1', username: 'acme', postUrl: 'https://ig/p/1',
  caption: 'hello', mediaKind: 'image', mediaUrl: 'https://cdn/x.jpg', capturedAt: 1,
  competitorHandle: '@acme',
} as CapturedPostSummary

describe('buildRawIdea', () => {
  it('assembles fields from an image post without transcribing', async () => {
    const transcribe = vi.fn()
    const raw = await buildRawIdea({ post: imgPost, transcribeMedia: transcribe })
    expect(raw.caption).toBe('hello')
    expect(raw.sourceUrl).toBe('https://ig/p/1')
    expect(raw.mediaKind).toBe('image')
    expect(raw.transcript).toBeUndefined()
    expect(transcribe).not.toHaveBeenCalled()
  })

  it('transcribes a video post and stores the transcript', async () => {
    const transcribe = vi.fn().mockResolvedValue('spoken words')
    const raw = await buildRawIdea({
      post: { ...imgPost, mediaKind: 'video', mediaUrl: 'https://cdn/v.mp4' },
      transcribeMedia: transcribe,
    })
    expect(transcribe).toHaveBeenCalledWith('https://cdn/v.mp4')
    expect(raw.transcript).toBe('spoken words')
  })

  it('falls back to referenceUrl when there is no post', async () => {
    const raw = await buildRawIdea({ referenceUrl: 'https://ig/p/9', transcribeMedia: vi.fn() })
    expect(raw.sourceUrl).toBe('https://ig/p/9')
    expect(raw.assetRefs).toEqual([])
  })
})
