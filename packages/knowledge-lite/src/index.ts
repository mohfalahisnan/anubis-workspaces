import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import type { EngineConfig } from './config.js'
import { DEFAULT_CONFIG } from './config.js'
import type { SearchResult } from './types.js'
import { ValidationError, FileSystemError } from './types.js'
import { buildIndex, indexIsFresh } from './index-store.js'
import { searchIndex, renderSearchResult } from './search.js'
import { resolveTargetPath } from './paths.js'
import { scanMarkdownFiles, toSourcePath } from './fs.js'

export type { EngineConfig } from './config.js'
export type { SearchResult, DocumentRow, Chunk } from './types.js'
export { ValidationError, IndexStoreError, FileSystemError } from './types.js'

export interface EngineOptions {
  /** Directory holding the markdown corpus (the workspace `knowledge/` dir). */
  sourceRoot: string
  /** Path to the per-project sqlite index file. */
  dbPath: string
  config?: Partial<EngineConfig>
}

export interface KnowledgeEngine {
  ingest(opts?: { full?: boolean }): { documents: number; chunks: number }
  search(opts: { query: string; limit?: number }): { query: string; results: SearchResult[]; lowConfidence: boolean; text: string }
  save(opts: { path: string; content: string; force?: boolean }): { path: string }
  update(opts: { path: string; content: string }): { path: string }
  delete(opts: { path: string }): { path: string }
  stats(): { documentCount: number; chunkCount: number; lastIndexedAt: string | null }
  listDocuments(): { items: Array<{ path: string; title: string; chunkCount: number; updatedAt: string }> }
  listFiles(): { items: Array<{ path: string; size: number; updatedAt: string }> }
  readFile(opts: { path: string }): { path: string; content: string }
}

export function createEngine(options: EngineOptions): KnowledgeEngine {
  const { sourceRoot, dbPath } = options
  const config: EngineConfig = { ...DEFAULT_CONFIG, ...(options.config ?? {}) }

  const ensureFresh = (): void => {
    if (!indexIsFresh(sourceRoot, dbPath)) buildIndex(sourceRoot, dbPath, config)
  }

  const writeDoc = (rawPath: string, content: string, mode: 'save' | 'update'): { path: string } => {
    const target = resolveTargetPath(sourceRoot, rawPath)
    if (mode === 'update' && !existsSync(target)) throw new ValidationError('target does not exist')
    mkdirSync(dirname(target), { recursive: true })
    try {
      writeFileSync(target, content, 'utf8')
    } catch (err) {
      throw new FileSystemError(`could not write ${rawPath}: ${String(err)}`)
    }
    buildIndex(sourceRoot, dbPath, config)
    return { path: rawPath }
  }

  return {
    ingest(opts) {
      mkdirSync(sourceRoot, { recursive: true })
      return buildIndex(sourceRoot, dbPath, config, opts?.full ?? false)
    },

    search(opts) {
      const query = opts.query.trim()
      if (!query) throw new ValidationError('query must not be empty')
      mkdirSync(sourceRoot, { recursive: true })
      ensureFresh()
      const limit = opts.limit ?? config.searchResultLimit
      const results = searchIndex(sourceRoot, dbPath, query, { ...config, searchResultLimit: limit })
      const lowConfidence = results.length > 0 && (results[0].coverage < 0.5 || results[0].rawScore < 1.0)
      return { query, results, lowConfidence, text: renderSearchResult(query, results) }
    },

    save(opts) {
      const target = resolveTargetPath(sourceRoot, opts.path)
      if (existsSync(target) && !opts.force) throw new ValidationError('target exists; pass force to overwrite')
      return writeDoc(opts.path, opts.content, 'save')
    },

    update(opts) {
      return writeDoc(opts.path, opts.content, 'update')
    },

    delete(opts) {
      const target = resolveTargetPath(sourceRoot, opts.path)
      if (!existsSync(target)) throw new ValidationError('target does not exist')
      try {
        rmSync(target, { force: true })
      } catch (err) {
        throw new FileSystemError(`could not delete ${opts.path}: ${String(err)}`)
      }
      buildIndex(sourceRoot, dbPath, config)
      return { path: opts.path }
    },

    stats() {
      if (!existsSync(dbPath)) return { documentCount: 0, chunkCount: 0, lastIndexedAt: null }
      const conn = new Database(dbPath, { readonly: true })
      try {
        const documentCount = (conn.prepare('SELECT COUNT(*) AS n FROM documents').get() as { n: number }).n
        const chunkCount = (conn.prepare('SELECT COUNT(*) AS n FROM chunks').get() as { n: number }).n
        const last = conn.prepare('SELECT MAX(updated_at) AS t FROM documents').get() as { t: string | null }
        return { documentCount, chunkCount, lastIndexedAt: last.t }
      } finally {
        conn.close()
      }
    },

    listDocuments() {
      if (!existsSync(dbPath)) return { items: [] }
      const conn = new Database(dbPath, { readonly: true })
      try {
        const rows = conn.prepare(`
          SELECT d.path, d.title, d.updated_at, COUNT(c.id) AS chunk_count
          FROM documents d LEFT JOIN chunks c ON c.document_id = d.id
          GROUP BY d.id ORDER BY d.path
        `).all() as Array<{ path: string; title: string; updated_at: string; chunk_count: number }>
        return { items: rows.map(r => ({ path: r.path, title: r.title, chunkCount: r.chunk_count, updatedAt: r.updated_at })) }
      } finally {
        conn.close()
      }
    },

    listFiles() {
      mkdirSync(sourceRoot, { recursive: true })
      const items = scanMarkdownFiles(sourceRoot).map((abs) => {
        const st = statSync(abs)
        return { path: toSourcePath(sourceRoot, abs), size: st.size, updatedAt: st.mtime.toISOString() }
      })
      return { items }
    },

    readFile(opts) {
      const target = resolveTargetPath(sourceRoot, opts.path)
      if (!existsSync(target)) throw new ValidationError('target does not exist')
      return { path: toSourcePath(sourceRoot, target), content: readFileSync(target, 'utf8') }
    },
  }
}
