import { describe, it, expect } from 'vitest'
import { jsonTransformerExecutor } from '../../src/executors/json-transformer.js'

const stubCtx = {
  crawler: { captureProfile: async () => ({ id: '', mediaUrls: [] }) },
  ocr: { extractFromImage: async () => '' },
  db: { getCapturedPost: async () => ({ id: '', mediaUrls: [] }) },
  fs: { writeRunArtifact: async () => '' },
  conversations: {
    createAndAwaitFirstTurn: async () => ({ conversationId: '', messageId: '', text: '' }),
    cancel: async () => {},
  },
  runId: 'r1',
  signal: new AbortController().signal,
  emit: () => {},
} as const

describe('jsonTransformerExecutor', () => {
  it('maps an input array into a new JSON structure', async () => {
    const out = await jsonTransformerExecutor.run(
      {
        nodeId: 'n1',
        config: {
          template: JSON.stringify({
            $map: 'input.rows',
            template: {
              label: 'example',
              value: '{{item.value}}',
            },
          }),
        },
        upstream: {
          source: {
            kind: 'json',
            value: {
              title: 'example json',
              rows: [{ value: 'value 1' }],
            },
          },
        },
        downstream: [],
      },
      stubCtx,
    )

    expect(out).toEqual({
      kind: 'json',
      value: [{ label: 'example', value: 'value 1' }],
    })
  })

  it('can use sourcePath and preserve whole-token value types', async () => {
    const out = await jsonTransformerExecutor.run(
      {
        nodeId: 'n1',
        config: {
          sourcePath: 'source.value',
          template: JSON.stringify({
            title: '{{input.title}}',
            firstRow: '{{input.rows.0}}',
            count: '{{input.count}}',
          }),
        },
        upstream: {
          source: {
            kind: 'json',
            value: {
              title: 'example json',
              count: 2,
              rows: [{ value: 'value 1' }],
            },
          },
        },
        downstream: [],
      },
      stubCtx,
    )

    expect(out).toEqual({
      kind: 'json',
      value: {
        title: 'example json',
        firstRow: { value: 'value 1' },
        count: 2,
      },
    })
  })

  it('throws when map path is not an array', async () => {
    await expect(
      jsonTransformerExecutor.run(
        {
          nodeId: 'n1',
          config: { template: JSON.stringify({ $map: 'input.rows', template: {} }) },
          upstream: { source: { rows: 'not rows' } },
          downstream: [],
        },
        stubCtx,
      ),
    ).rejects.toThrow(/not an array/i)
  })

  it('throws on invalid template JSON', async () => {
    await expect(
      jsonTransformerExecutor.run(
        { nodeId: 'n1', config: { template: 'not json' }, upstream: {}, downstream: [] },
        stubCtx,
      ),
    ).rejects.toThrow()
  })
})
