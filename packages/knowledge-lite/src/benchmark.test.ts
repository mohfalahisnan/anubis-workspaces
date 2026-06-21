import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { computeMetrics, probeQueryForChunk, benchmarkSelfTest } from './benchmark.js'
import { buildIndex } from './index-store.js'
import { DEFAULT_CONFIG, BENCHMARK_DEPTH } from './config.js'

describe('computeMetrics', () => {
  it('matches known ranks', () => {
    const m = computeMetrics([1, 2, null, 1, 5], 10)
    expect(m.count).toBe(5)
    expect(m.pAt1).toBeCloseTo(2 / 5)
    expect(m.mrr).toBeCloseTo((1 + 0.5 + 0 + 1 + 0.2) / 5)
    expect(m.recallAt3).toBeCloseTo(3 / 5)
    expect(m.misses).toBe(1)
  })
  it('treats rank beyond depth as a miss', () => {
    const m = computeMetrics([12, 3], 10)
    expect(m.misses).toBe(1)
  })
})

describe('probeQueryForChunk', () => {
  it('picks top tf*idf terms', () => {
    const chunk = { terms: new Map([['rare', 1], ['common', 5], ['alsorare', 1]]) }
    const idf = new Map([['rare', 2.0], ['common', 0.1], ['alsorare', 2.0]])
    expect(new Set(probeQueryForChunk(chunk.terms, idf, 2).split(' '))).toEqual(new Set(['rare', 'alsorare']))
  })
})

describe('benchmarkSelfTest', () => {
  let src: string; let db: string
  beforeEach(() => { const tmp = mkdtempSync(join(tmpdir(), 'kl-bench-')); src = join(tmp, 'k'); db = join(tmp, 'i.db'); mkdirSync(src, { recursive: true }) })
  afterEach(() => { rmSync(join(src, '..'), { recursive: true, force: true }) })
  const index = (files: Record<string, string>) => {
    for (const [k, v] of Object.entries(files)) { const p = join(src, k); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, v, 'utf8') }
    buildIndex(src, db, DEFAULT_CONFIG)
  }
  it('distinct docs all rank 1', () => {
    index({ 'fruit.md': '# Fruit\n\napple banana cherry mango\n', 'cars.md': '# Cars\n\nengine wheel chassis turbo\n', 'music.md': '# Music\n\nguitar melody rhythm tempo\n' })
    const { metrics } = benchmarkSelfTest(src, db, DEFAULT_CONFIG, BENCHMARK_DEPTH)
    expect(metrics.pAt1).toBe(1.0)
    expect(metrics.misses).toBe(0)
  })
})
