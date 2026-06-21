import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import type { EngineConfig } from './config.js'
import {
  BM25_B, BM25_K1, CONF_COVERAGE_MIN, CONF_SCORE_FLOOR, HEADING_BOOST,
  PROX_GAIN, SEARCH_POOL_MIN, SEARCH_POOL_MULTIPLIER,
} from './config.js'
import type { SearchResult } from './types.js'
import { IndexStoreError } from './types.js'
import { normalizeTerms } from './text.js'

export function parseQuery(query: string): { phrases: string[][]; terms: string[] } {
  const phrases: string[][] = []
  const freeChunks: string[] = []
  let last = 0
  const re = /"([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(query)) !== null) {
    freeChunks.push(query.slice(last, m.index))
    const tokens = normalizeTerms(m[1])
    if (tokens.length) phrases.push(tokens)
    last = m.index + m[0].length
  }
  freeChunks.push(query.slice(last))
  const terms: string[] = []
  const seen = new Set<string>()
  for (const token of normalizeTerms(freeChunks.join(' '))) {
    if (!seen.has(token)) { seen.add(token); terms.push(token) }
  }
  for (const phrase of phrases) {
    for (const token of phrase) {
      if (!seen.has(token)) { seen.add(token); terms.push(token) }
    }
  }
  return { phrases, terms }
}

export function containsPhrase(tokenStream: string[], phraseTokens: string[]): boolean {
  if (phraseTokens.length === 0) return true
  const span = phraseTokens.length
  if (span > tokenStream.length) return false
  for (let start = 0; start <= tokenStream.length - span; start++) {
    let ok = true
    for (let i = 0; i < span; i++) {
      if (tokenStream[start + i] !== phraseTokens[i]) { ok = false; break }
    }
    if (ok) return true
  }
  return false
}

export function proximityFactor(tokenStream: string[], queryTerms: string[]): number {
  const querySet = new Set(queryTerms)
  const occurrences: Array<[number, string]> = []
  tokenStream.forEach((tok, i) => { if (querySet.has(tok)) occurrences.push([i, tok]) })
  const distinctPresent = new Set(occurrences.map(o => o[1]))
  if (distinctPresent.size < 2) return 0
  const target = distinctPresent.size
  let bestWidth: number | null = null
  const counts = new Map<string, number>()
  let have = 0
  let left = 0
  for (let right = 0; right < occurrences.length; right++) {
    const tok = occurrences[right][1]
    counts.set(tok, (counts.get(tok) ?? 0) + 1)
    if (counts.get(tok) === 1) have++
    while (have === target) {
      const width = occurrences[right][0] - occurrences[left][0]
      if (bestWidth === null || width < bestWidth) bestWidth = width
      const leftTok = occurrences[left][1]
      counts.set(leftTok, (counts.get(leftTok) as number) - 1)
      if (counts.get(leftTok) === 0) have--
      left++
    }
  }
  if (bestWidth === null) return 0
  const tightness = Math.min(1, (target - 1) / bestWidth)
  const coverage = distinctPresent.size / querySet.size
  return coverage * tightness
}

interface CandidateMeta { sourcePath: string; chunkIndex: number; heading: string | null; startLine: number; endLine: number }

function chunkTokenStream(sourceRoot: string, sourcePath: string, startLine: number, endLine: number, cache: Map<string, string[]>): string[] {
  let lines = cache.get(sourcePath)
  if (lines === undefined) {
    try { lines = readFileSync(join(sourceRoot, sourcePath), 'utf8').split('\n') } catch { lines = [] }
    cache.set(sourcePath, lines)
  }
  const start = Math.max(0, startLine - 1)
  return normalizeTerms(lines.slice(start, endLine).join('\n'))
}

export function searchIndex(sourceRoot: string, dbPath: string, query: string, config: EngineConfig): SearchResult[] {
  const { phrases, terms: queryTerms } = parseQuery(query)
  if (queryTerms.length === 0) return []
  if (!existsSync(dbPath)) return []

  let nChunks = 0
  let avgdl = 1
  const lengths = new Map<number, number>()
  const idf = new Map<string, number>()
  const candTerms = new Map<number, Map<string, number>>()
  const candMeta = new Map<number, CandidateMeta>()

  try {
    const conn = new Database(dbPath, { readonly: true })
    try {
      for (const row of conn.prepare('SELECT chunk_id, SUM(frequency) AS len FROM terms GROUP BY chunk_id').all() as Array<{ chunk_id: number; len: number }>) {
        lengths.set(row.chunk_id, row.len)
      }
      nChunks = (conn.prepare('SELECT COUNT(*) AS n FROM chunks').get() as { n: number }).n
      if (!nChunks) return []
      const total = [...lengths.values()].reduce((a, b) => a + b, 0)
      avgdl = nChunks ? total / nChunks : 1
      if (!avgdl) avgdl = 1

      const placeholders = queryTerms.map(() => '?').join(',')
      const dfRows = conn.prepare(`SELECT term, COUNT(DISTINCT chunk_id) AS df FROM terms WHERE term IN (${placeholders}) GROUP BY term`).all(...queryTerms) as Array<{ term: string; df: number }>
      const docFreq = new Map(dfRows.map(r => [r.term, r.df]))
      for (const term of queryTerms) {
        const nT = docFreq.get(term) ?? 0
        idf.set(term, nT ? Math.log(1 + (nChunks - nT + 0.5) / (nT + 0.5)) : 0)
      }

      const candRows = conn.prepare(`
        SELECT c.id AS chunk_id, d.path AS source_path, c.chunk_index, c.heading,
               c.start_line, c.end_line, t.term, t.frequency
        FROM terms t
        JOIN chunks c ON c.id = t.chunk_id
        JOIN documents d ON d.id = c.document_id
        WHERE t.term IN (${placeholders})
      `).all(...queryTerms) as Array<{ chunk_id: number; source_path: string; chunk_index: number; heading: string | null; start_line: number; end_line: number; term: string; frequency: number }>
      for (const row of candRows) {
        let tf = candTerms.get(row.chunk_id)
        if (!tf) { tf = new Map(); candTerms.set(row.chunk_id, tf) }
        tf.set(row.term, row.frequency)
        if (!candMeta.has(row.chunk_id)) {
          candMeta.set(row.chunk_id, { sourcePath: row.source_path, chunkIndex: row.chunk_index, heading: row.heading, startLine: row.start_line, endLine: row.end_line })
        }
      }
    } finally {
      conn.close()
    }
  } catch (err) {
    throw new IndexStoreError(`could not search sqlite index: ${String(err)}`)
  }

  if (candTerms.size === 0) return []

  const totalTerms = queryTerms.length
  const bm25 = new Map<number, number>()
  const matchedCounts = new Map<number, number>()
  for (const [cid, termFreqs] of candTerms) {
    const dl = lengths.get(cid) || 1
    const headingTerms = new Set(normalizeTerms(candMeta.get(cid)!.heading ?? ''))
    let score = 0
    let matched = 0
    for (const term of queryTerms) {
      const freq = termFreqs.get(term) ?? 0
      if (freq) {
        matched++
        const denom = freq + BM25_K1 * (1 - BM25_B + BM25_B * dl / avgdl)
        score += (idf.get(term) as number) * (freq * (BM25_K1 + 1)) / denom
      }
      if (headingTerms.has(term)) score += HEADING_BOOST * (idf.get(term) as number)
    }
    bm25.set(cid, score)
    matchedCounts.set(cid, matched)
  }

  const ordered = [...bm25.keys()].sort((a, b) => {
    const d = (bm25.get(b) as number) - (bm25.get(a) as number)
    if (d !== 0) return d
    const ma = candMeta.get(a)!; const mb = candMeta.get(b)!
    return ma.sourcePath.localeCompare(mb.sourcePath) || ma.startLine - mb.startLine
  })

  const required = new Set<string>()
  for (const phrase of phrases) for (const tok of phrase) required.add(tok)

  let pool: number[]
  if (phrases.length) {
    pool = ordered.filter(cid => [...required].every(tok => (candTerms.get(cid)?.get(tok) ?? 0) > 0))
  } else {
    const poolSize = Math.max(config.searchResultLimit * SEARCH_POOL_MULTIPLIER, SEARCH_POOL_MIN)
    pool = ordered.slice(0, poolSize)
  }

  const fileCache = new Map<string, string[]>()
  const results: SearchResult[] = []
  for (const cid of pool) {
    const meta = candMeta.get(cid)!
    const stream = chunkTokenStream(sourceRoot, meta.sourcePath, meta.startLine, meta.endLine, fileCache)
    if (phrases.length && !phrases.every(phrase => containsPhrase(stream, phrase))) continue
    const factor = proximityFactor(stream, queryTerms)
    const final = (bm25.get(cid) as number) * (1 + PROX_GAIN * factor)
    results.push({
      source: meta.sourcePath,
      startLine: meta.startLine,
      endLine: meta.endLine,
      excerptStartLine: 0,
      excerptEndLine: 0,
      heading: meta.heading,
      rawScore: final,
      coverage: totalTerms ? (matchedCounts.get(cid) as number) / totalTerms : 0,
      score: 0,
      excerpt: '',
    })
  }

  results.sort((a, b) => (b.rawScore - a.rawScore) || a.source.localeCompare(b.source) || a.startLine - b.startLine)
  const trimmed = results.slice(0, config.searchResultLimit)
  const topRaw = trimmed.length ? trimmed[0].rawScore : 0
  for (const r of trimmed) {
    r.score = topRaw ? r.rawScore / topRaw : 0
    const [start, end, excerpt] = excerptForResult(sourceRoot, r, config)
    r.excerptStartLine = start
    r.excerptEndLine = end
    r.excerpt = excerpt
  }
  return trimmed
}

function excerptForResult(sourceRoot: string, result: SearchResult, config: EngineConfig): [number, number, string] {
  let sourceLines: string[]
  try {
    sourceLines = readFileSync(join(sourceRoot, result.source), 'utf8').split('\n')
  } catch {
    return [result.startLine, result.endLine, '']
  }
  if (sourceLines.length === 0) return [1, 1, '']
  const start = Math.max(1, result.startLine - config.searchExcerptLinesBefore)
  const end = Math.min(sourceLines.length, result.endLine + config.searchExcerptLinesAfter)
  return [start, end, sourceLines.slice(start - 1, end).join('\n')]
}

export function renderSearchResult(query: string, results: SearchResult[]): string {
  const lines = ['# Search Result', '', `Query: ${query}`, '']
  if (results.length === 0) {
    lines.push('No results found.', '')
    return lines.join('\n')
  }
  const top = results[0]
  if (top.coverage < CONF_COVERAGE_MIN || top.rawScore < CONF_SCORE_FLOOR) {
    lines.push('> Low confidence — the top match is weak; this may not be in the knowledge base.', '')
  }
  results.forEach((result, idx) => {
    lines.push(
      `## Result ${idx + 1}`, '',
      `Source: ${result.source}  `,
      `Lines: ${result.excerptStartLine}-${result.excerptEndLine}  `,
      `Score: ${result.score.toFixed(2)}`, '',
      'Excerpt:', '', '```md', result.excerpt, '```', '',
    )
  })
  return lines.join('\n')
}
