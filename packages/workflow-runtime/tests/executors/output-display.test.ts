import { describe, it, expect } from 'vitest'
import { markdownDisplayExecutor } from '../../src/executors/markdown-display.js'
import { mediaDisplayExecutor } from '../../src/executors/media-display.js'

const ctx = {} as never
const base = { nodeId: 'n1', downstream: [] as Array<{ nodeId: string; type: string }> }

describe('markdownDisplayExecutor', () => {
  it('passes through upstream text', async () => {
    const out = await markdownDisplayExecutor.run(
      { ...base, config: {}, upstream: { up: { text: '# Hello' } } }, ctx,
    )
    expect(out).toEqual({ kind: 'markdown', text: '# Hello' })
  })

  it('accepts a bare upstream string', async () => {
    const out = await markdownDisplayExecutor.run(
      { ...base, config: {}, upstream: { up: 'plain' } }, ctx,
    )
    expect(out).toEqual({ kind: 'markdown', text: 'plain' })
  })

  it('falls back to static text when no upstream text', async () => {
    const out = await markdownDisplayExecutor.run(
      { ...base, config: { staticText: 'fallback' }, upstream: {} }, ctx,
    )
    expect(out).toEqual({ kind: 'markdown', text: 'fallback' })
  })
})

describe('mediaDisplayExecutor', () => {
  it('passes through the first upstream file', async () => {
    const out = await mediaDisplayExecutor.run(
      { ...base, config: {}, upstream: { up: { kind: 'file', path: '/a/b.png', mimeType: 'image/png' } } }, ctx,
    )
    expect(out).toEqual({ kind: 'file', path: '/a/b.png', mimeType: 'image/png' })
  })

  it('uses the first file from an upstream files bundle', async () => {
    const out = await mediaDisplayExecutor.run(
      {
        ...base,
        config: {},
        upstream: {
          up: {
            kind: 'files',
            files: [
              { kind: 'file', path: '/a/first.png', mimeType: 'image/png' },
              { kind: 'file', path: '/a/second.png', mimeType: 'image/png' },
            ],
          },
        },
      },
      ctx,
    )
    expect(out).toEqual({ kind: 'file', path: '/a/first.png', mimeType: 'image/png' })
  })

  it('throws when no file is found upstream', async () => {
    await expect(
      mediaDisplayExecutor.run({ ...base, config: {}, upstream: { up: { text: 'nope' } } }, ctx),
    ).rejects.toThrow(/no file/i)
  })
})
