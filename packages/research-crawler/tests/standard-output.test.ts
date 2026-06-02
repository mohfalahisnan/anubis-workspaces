import assert from 'node:assert/strict'
import { test } from 'node:test'
import { standardizeInstagramCaptureResult } from '../src/core/standard-output.js'
import type { InstagramCdpCaptureResult } from '../src/core/services/instagram-cdp-capture.service.js'

function captureResult(media: InstagramCdpCaptureResult extends { media: infer M } ? M : never): InstagramCdpCaptureResult {
  return {
    ok: true,
    profiles: [],
    media,
    rawResponses: [],
    meta: {
      chromeOrigin: 'http://127.0.0.1:9222/',
      tabUrl: 'https://www.instagram.com/p/Abc/',
      matchedResponses: 1,
      parsedResponses: 1,
      startedAt: '2026-05-29T00:00:00.000Z',
      completedAt: '2026-05-29T00:00:01.000Z'
    }
  }
}

test('surfaces caption and media on PostData', () => {
  const out = standardizeInstagramCaptureResult(
    { target: 'instagram', mode: 'profile_capture' },
    captureResult([
      {
        username: 'creator',
        postUrl: 'https://www.instagram.com/p/Abc/',
        likes: 10,
        comment: 2,
        timestamp: '2026-05-01T00:00:00.000Z',
        caption: 'a real caption',
        media: { kind: 'video', urls: ['https://img/thumb.jpg'], videoUrl: 'https://v/clip.mp4' }
      }
    ])
  )

  assert.equal(out.ok, true)
  const post = out.output.posts[0]
  assert.equal(post.caption, 'a real caption')
  assert.deepEqual(post.media, { kind: 'video', urls: ['https://img/thumb.jpg'], videoUrl: 'https://v/clip.mp4' })
})
