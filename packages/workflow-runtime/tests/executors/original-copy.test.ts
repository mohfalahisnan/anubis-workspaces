import { describe, it, expect } from 'vitest'
import { originalCopyExecutor } from '../../src/executors/original-copy.js'

const ctx = {} as never
const base = { nodeId: 'n1', downstream: [] as Array<{ nodeId: string; type: string }> }

describe('originalCopyExecutor', () => {
  it('extracts the caption from an Instagram Post output', async () => {
    const out = await originalCopyExecutor.run(
      {
        ...base,
        config: {},
        upstream: { ig: { kind: 'instagramPost', post: { id: 'p1', caption: 'Original caption ✨', mediaPaths: [] } } },
      },
      ctx,
    )
    expect(out).toEqual({ kind: 'originalCopy', text: 'Original caption ✨' })
  })

  it('extracts a top-level caption field from a captured-post-like value', async () => {
    const out = await originalCopyExecutor.run(
      { ...base, config: {}, upstream: { up: { caption: 'Bare caption', mediaUrls: [] } } },
      ctx,
    )
    expect(out).toEqual({ kind: 'originalCopy', text: 'Bare caption' })
  })

  it('falls back to generic upstream text', async () => {
    const out = await originalCopyExecutor.run(
      { ...base, config: {}, upstream: { up: { text: 'some text' } } },
      ctx,
    )
    expect(out).toEqual({ kind: 'originalCopy', text: 'some text' })
  })

  it('falls back to static text when no upstream carries copy', async () => {
    const out = await originalCopyExecutor.run(
      { ...base, config: { staticText: 'fallback copy' }, upstream: {} },
      ctx,
    )
    expect(out).toEqual({ kind: 'originalCopy', text: 'fallback copy' })
  })

  it('returns empty text when nothing is available', async () => {
    const out = await originalCopyExecutor.run({ ...base, config: {}, upstream: {} }, ctx)
    expect(out).toEqual({ kind: 'originalCopy', text: '' })
  })

  it('prefers the post caption over a sibling text field', async () => {
    const out = await originalCopyExecutor.run(
      {
        ...base,
        config: {},
        upstream: {
          analysis: { text: 'analysis prose' },
          ig: { kind: 'instagramPost', post: { id: 'p1', caption: 'the real original', mediaPaths: [] } },
        },
      },
      ctx,
    )
    expect(out).toEqual({ kind: 'originalCopy', text: 'the real original' })
  })
})
