import type { EngineConfig } from './config.js'
import { readChunksFromDb } from './index-store.js'
import { searchIndex } from './search.js'

export interface Metrics {
  count: number
  pAt1: number
  mrr: number
  recallAt3: number
  recallAt5: number
  missRate: number
  meanRank: number | null
  misses: number
}

export function computeMetrics(ranks: Array<number | null>, depth: number): Metrics {
  const n = ranks.length
  if (n === 0) return { count: 0, pAt1: 0, mrr: 0, recallAt3: 0, recallAt5: 0, missRate: 0, meanRank: null, misses: 0 }
  const found = ranks.filter((r): r is number => r !== null && r <= depth)
  const misses = n - found.length
  return {
    count: n,
    pAt1: found.filter(r => r === 1).length / n,
    mrr: found.reduce((acc, r) => acc + 1 / r, 0) / n,
    recallAt3: found.filter(r => r <= 3).length / n,
    recallAt5: found.filter(r => r <= 5).length / n,
    missRate: misses / n,
    meanRank: found.length ? found.reduce((a, b) => a + b, 0) / found.length : null,
    misses,
  }
}

export function probeQueryForChunk(terms: Map<string, number>, idf: Map<string, number>, topN: number): string {
  const scored = [...terms.entries()].sort((a, b) => {
    const sa = a[1] * (idf.get(a[0]) ?? 0)
    const sb = b[1] * (idf.get(b[0]) ?? 0)
    if (sb !== sa) return sb - sa
    return a[0].localeCompare(b[0])
  })
  return scored.slice(0, topN).map(([term]) => term).join(' ')
}

function idfFromChunks(chunks: Array<{ terms: Map<string, number> }>): Map<string, number> {
  const nChunks = chunks.length
  const docFreq = new Map<string, number>()
  for (const chunk of chunks) {
    for (const term of chunk.terms.keys()) docFreq.set(term, (docFreq.get(term) ?? 0) + 1)
  }
  const idf = new Map<string, number>()
  for (const [term, nT] of docFreq) idf.set(term, Math.log(1 + (nChunks - nT + 0.5) / (nT + 0.5)))
  return idf
}

const PROBE_TERMS = 3

export function benchmarkSelfTest(sourceRoot: string, dbPath: string, config: EngineConfig, depth: number): { metrics: Metrics } {
  const { chunks } = readChunksFromDb(dbPath)
  const idf = idfFromChunks(chunks)
  const searchConfig: EngineConfig = { ...config, searchResultLimit: depth }
  const ranks: Array<number | null> = []
  const sorted = [...chunks].sort((a, b) => a.sourcePath.localeCompare(b.sourcePath) || a.chunkIndex - b.chunkIndex)
  for (const chunk of sorted) {
    const probe = probeQueryForChunk(chunk.terms, idf, PROBE_TERMS)
    if (!probe) continue
    const results = searchIndex(sourceRoot, dbPath, probe, searchConfig)
    let rank: number | null = null
    results.forEach((r, position) => {
      if (rank === null && r.source === chunk.sourcePath && r.startLine === chunk.startLine) rank = position + 1
    })
    ranks.push(rank)
  }
  return { metrics: computeMetrics(ranks, depth) }
}
