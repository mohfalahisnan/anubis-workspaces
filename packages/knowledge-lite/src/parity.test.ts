import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, cpSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildIndex } from './index-store.js'
import { benchmarkSelfTest } from './benchmark.js'
import { DEFAULT_CONFIG, BENCHMARK_DEPTH } from './config.js'

const fixtures = join(fileURLToPath(new URL('.', import.meta.url)), '__fixtures__', 'knowledge')

let sourceRoot: string
let dbPath: string

beforeEach(() => {
  const tmp = mkdtempSync(join(tmpdir(), 'kl-parity-'))
  sourceRoot = join(tmp, 'knowledge')
  dbPath = join(tmp, 'index.db')
  cpSync(fixtures, sourceRoot, { recursive: true })
})

afterEach(() => {
  rmSync(join(sourceRoot, '..'), { recursive: true, force: true })
})

describe('parity self-test over the example corpus', () => {
  it('meets the Python-baseline retrieval quality', () => {
    // Python baseline (measured 2026-06-21 on same 6-doc corpus):
    //   P@1 = 1.000, MRR = 1.000
    // Thresholds set to baseline minus epsilon (0.02).
    buildIndex(sourceRoot, dbPath, DEFAULT_CONFIG)
    const { metrics } = benchmarkSelfTest(sourceRoot, dbPath, DEFAULT_CONFIG, BENCHMARK_DEPTH)
    expect(metrics.pAt1).toBeGreaterThanOrEqual(0.98)
    expect(metrics.mrr).toBeGreaterThanOrEqual(0.98)
  })
})
