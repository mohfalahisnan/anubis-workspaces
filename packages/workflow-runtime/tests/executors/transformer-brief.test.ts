import { describe, it, expect } from 'vitest'
import { transformerBriefExecutor } from '../../src/executors/transformer-brief.js'

const stubCtx = {
  agent: { run: async () => ({ text: '' }) },
  crawler: { captureProfile: async () => ({ id: '', mediaUrls: [] }) },
  ocr: { extractFromImage: async () => '' },
  db: { getCapturedPost: async () => ({ id: '', mediaUrls: [] }) },
  fs: { writeRunArtifact: async () => '' },
  runId: 'r1',
  signal: new AbortController().signal,
  emit: () => {},
} as const

describe('transformerBriefExecutor', () => {
  it('substitutes simple path tokens', async () => {
    const out = await transformerBriefExecutor.run(
      {
        nodeId: 'n1',
        config: { jsonTemplate: '{"topic":"{{n2.text}}"}' },
        upstream: { n2: { text: 'hello world' } },
      },
      stubCtx,
    )
    expect(out).toEqual({ kind: 'json', value: { topic: 'hello world' } })
  })

  it('substitutes nested path tokens', async () => {
    const out = await transformerBriefExecutor.run(
      {
        nodeId: 'n1',
        config: { jsonTemplate: '{"first":"{{n2.post.mediaUrls.0}}"}' },
        upstream: { n2: { post: { mediaUrls: ['https://a', 'https://b'] } } },
      },
      stubCtx,
    )
    expect(out).toEqual({ kind: 'json', value: { first: 'https://a' } })
  })

  it('throws on invalid JSON after substitution', async () => {
    await expect(
      transformerBriefExecutor.run(
        { nodeId: 'n1', config: { jsonTemplate: 'not json' }, upstream: {} },
        stubCtx,
      ),
    ).rejects.toThrow()
  })

  it('throws on missing token path', async () => {
    await expect(
      transformerBriefExecutor.run(
        { nodeId: 'n1', config: { jsonTemplate: '{"x":"{{missing.path}}"}' }, upstream: {} },
        stubCtx,
      ),
    ).rejects.toThrow(/missing/i)
  })
})
