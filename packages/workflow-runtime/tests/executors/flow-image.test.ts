import { describe, it, expect, vi } from 'vitest'
import { flowImageExecutor } from '../../src/executors/flow-image.js'
import type { FlowImageNodeOptions, FlowImageNodeResult } from '../../src/types.js'

function ctxWithFlow(flowFn: (input: FlowImageNodeOptions) => Promise<FlowImageNodeResult>) {
  return {
    crawler: { captureProfile: async () => ({ id: '', mediaUrls: [] }) },
    ocr: { extractFromImage: async () => '' },
    flow: { generate: flowFn },
    db: { getCapturedPost: async () => ({ id: '', mediaUrls: [] }) },
    fs: { writeRunArtifact: async () => '' },
    runId: 'r1',
    signal: new AbortController().signal,
    emit: () => {},
  } as const
}

const result: FlowImageNodeResult = {
  resultEditUrls: ['https://labs.google/fx/x/edit/1'],
  downloadedImagePaths: ['/out/img_01.jpg'],
  model: 'Nano Banana Pro',
  ratio: '1:1',
  variations: 1,
  tabUrl: 'https://labs.google/fx/x/project/abc',
}

describe('flowImageExecutor', () => {
  it('uses config.prompt and passes options through', async () => {
    const gen = vi.fn().mockResolvedValue(result)
    const out = await flowImageExecutor.run(
      {
        nodeId: 'n1',
        config: { prompt: 'a red apple', ratio: '16:9', variations: 2, model: 'Nano Banana 2', projectUrl: 'https://labs.google/fx/x/project/abc', downloadDir: '/out' },
        upstream: {},
        downstream: [],
      },
      ctxWithFlow(gen),
    )
    expect(gen).toHaveBeenCalledWith({
      prompt: 'a red apple',
      ratio: '16:9',
      variations: 2,
      model: 'Nano Banana 2',
      projectUrl: 'https://labs.google/fx/x/project/abc',
      downloadDir: '/out',
    })
    expect(out).toEqual({ kind: 'json', value: result })
  })

  it('falls back to upstream text when no config.prompt', async () => {
    const gen = vi.fn().mockResolvedValue(result)
    await flowImageExecutor.run(
      { nodeId: 'n1', config: {}, upstream: { n2: { kind: 'text', text: '  a blue car  ' } }, downstream: [] },
      ctxWithFlow(gen),
    )
    expect(gen).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'a blue car' }))
  })

  it('throws when no prompt is available', async () => {
    await expect(
      flowImageExecutor.run({ nodeId: 'n1', config: {}, upstream: {}, downstream: [] }, ctxWithFlow(async () => result)),
    ).rejects.toThrow(/no prompt/i)
  })
})
