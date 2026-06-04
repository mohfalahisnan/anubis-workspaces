import { describe, it, expect, vi } from 'vitest'
import { ocrExtractorExecutor } from '../../src/executors/ocr-extractor.js'

function ctxWithOcr(ocrFn: (path: string) => Promise<string>) {
  return {
    agent: { run: async () => ({ text: '' }) },
    crawler: { captureProfile: async () => ({ id: '', mediaUrls: [] }) },
    ocr: { extractFromImage: ocrFn },
    db: { getCapturedPost: async () => ({ id: '', mediaUrls: [] }) },
    fs: { writeRunArtifact: async () => '' },
    runId: 'r1',
    signal: new AbortController().signal,
    emit: () => {},
  } as const
}

describe('ocrExtractorExecutor', () => {
  it('uses config.imagePath when provided', async () => {
    const ocr = vi.fn().mockResolvedValue('extracted text')
    const out = await ocrExtractorExecutor.run(
      { nodeId: 'n1', config: { imagePath: '/p/x.png' }, upstream: {} },
      ctxWithOcr(ocr),
    )
    expect(ocr).toHaveBeenCalledWith('/p/x.png')
    expect(out).toEqual({ kind: 'text', text: 'extracted text' })
  })

  it('falls back to first upstream file path', async () => {
    const ocr = vi.fn().mockResolvedValue('OCR!')
    await ocrExtractorExecutor.run(
      {
        nodeId: 'n1',
        config: {},
        upstream: { n2: { kind: 'file', path: '/p/up.png' } },
      },
      ctxWithOcr(ocr),
    )
    expect(ocr).toHaveBeenCalledWith('/p/up.png')
  })

  it('throws when no image source available', async () => {
    await expect(
      ocrExtractorExecutor.run({ nodeId: 'n1', config: {}, upstream: {} }, ctxWithOcr(async () => '')),
    ).rejects.toThrow(/no.*image/i)
  })
})
