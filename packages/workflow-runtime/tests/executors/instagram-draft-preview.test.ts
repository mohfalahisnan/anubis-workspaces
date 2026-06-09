import { describe, expect, it } from 'vitest'
import { instagramDraftPreviewExecutor } from '../../src/executors/instagram-draft-preview.js'

const ctx = {} as never
const base = { nodeId: 'n1', downstream: [] as Array<{ nodeId: string; type: string }> }

describe('instagramDraftPreviewExecutor', () => {
  it('merges upstream JSON fields into a preview payload', async () => {
    const out = await instagramDraftPreviewExecutor.run(
      {
        ...base,
        config: {},
        upstream: {
          draft: {
            kind: 'json',
            value: {
              caption: 'Launch day #anubis @team',
              mediaUrl: 'https://example.com/post.jpg',
              username: '@anubis',
              avatarUrl: 'https://example.com/avatar.jpg',
              likesCount: '1,234',
              commentsCount: 56,
              format: 'reels',
            },
          },
        },
      },
      ctx,
    )

    expect(out).toEqual({
      kind: 'instagramDraftPreview',
      caption: 'Launch day #anubis @team',
      mediaUrl: 'https://example.com/post.jpg',
      username: 'anubis',
      avatarUrl: 'https://example.com/avatar.jpg',
      likesCount: 1234,
      commentsCount: 56,
      format: 'reels',
    })
  })

  it('understands an Instagram Post output and config fallbacks', async () => {
    const out = await instagramDraftPreviewExecutor.run(
      {
        ...base,
        config: { username: 'fallback_user', format: 'post' },
        upstream: {
          post: {
            kind: 'instagramPost',
            post: {
              caption: 'Original caption',
              mediaPaths: ['C:\\runs\\media.png'],
              metrics: { likes: 10, comments: 2 },
            },
          },
        },
      },
      ctx,
    )

    expect(out).toMatchObject({
      kind: 'instagramDraftPreview',
      caption: 'Original caption',
      mediaUrl: 'C:\\runs\\media.png',
      username: 'fallback_user',
      likesCount: 10,
      commentsCount: 2,
      format: 'post',
    })
  })

  it('requires media and username', async () => {
    await expect(
      instagramDraftPreviewExecutor.run({ ...base, config: { username: 'anubis' }, upstream: {} }, ctx),
    ).rejects.toThrow(/mediaUrl is required/)

    await expect(
      instagramDraftPreviewExecutor.run({ ...base, config: { mediaUrl: 'https://example.com/post.jpg' }, upstream: {} }, ctx),
    ).rejects.toThrow(/username is required/)
  })
})
