import { describe, it, expect } from 'vitest'
import { tableExecutor } from '../../src/executors/table.js'

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

describe('tableExecutor', () => {
  it('passes upstream values through as rows', async () => {
    const out = await tableExecutor.run(
      { nodeId: 'n1', config: {}, upstream: { up1: { a: 1 } } },
      stubCtx,
    )
    expect(out).toEqual({ kind: 'table', rows: [{ a: 1 }] })
  })

  it('falls back to staticData when upstream is empty', async () => {
    const out = await tableExecutor.run(
      { nodeId: 'n1', config: { staticData: [{ a: 1 }, { a: 2 }] }, upstream: {} },
      stubCtx,
    )
    expect(out).toEqual({ kind: 'table', rows: [{ a: 1 }, { a: 2 }] })
  })

  it('returns empty rows when no upstream and no staticData', async () => {
    const out = await tableExecutor.run({ nodeId: 'n1', config: {}, upstream: {} }, stubCtx)
    expect(out).toEqual({ kind: 'table', rows: [] })
  })

  it('rejects invalid config via validateConfig', () => {
    expect(() => tableExecutor.validateConfig({ staticData: 'not-an-array' })).toThrow()
  })
})
