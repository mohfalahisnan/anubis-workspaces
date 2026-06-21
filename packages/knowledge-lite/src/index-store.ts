import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import Database from 'better-sqlite3'
import type { EngineConfig } from './config.js'
import { INDEX_VERSION, SCHEMA_SQL } from './config.js'
import type { Chunk, DocumentRow } from './types.js'
import { FileSystemError, IndexStoreError } from './types.js'
import { chunksForFile, sha256Text } from './chunking.js'
import { titleFromText } from './text.js'
import { scanMarkdownFiles, toSourcePath, utcNow } from './fs.js'

interface ReusableEntry {
  contentHash: string
  title: string
  updatedAt: string
  chunks: Chunk[]
}

export function readChunksFromDb(dbPath: string): { documents: DocumentRow[]; chunks: Chunk[] } {
  let conn: Database.Database
  try {
    conn = new Database(dbPath, { readonly: true })
  } catch (err) {
    throw new IndexStoreError(`could not open sqlite index: ${String(err)}`)
  }
  try {
    const docRows = conn.prepare('SELECT path, title, content_hash, updated_at FROM documents ORDER BY path').all() as Array<{ path: string; title: string; content_hash: string; updated_at: string }>
    const rows = conn.prepare(`
      SELECT d.path AS source_path, c.chunk_index, c.heading, c.start_line, c.end_line,
             c.token_estimate, c.content_hash, t.term, t.frequency
      FROM documents d
      JOIN chunks c ON c.document_id = d.id
      LEFT JOIN terms t ON t.chunk_id = c.id
      ORDER BY d.path, c.chunk_index, t.term
    `).all() as Array<{ source_path: string; chunk_index: number; heading: string | null; start_line: number; end_line: number; token_estimate: number; content_hash: string; term: string | null; frequency: number | null }>

    const documents: DocumentRow[] = docRows.map(r => ({ path: r.path, title: r.title, contentHash: r.content_hash, updatedAt: r.updated_at }))
    const chunkMap = new Map<string, Chunk>()
    for (const row of rows) {
      const key = `${row.source_path} ${row.chunk_index}`
      let chunk = chunkMap.get(key)
      if (!chunk) {
        chunk = {
          sourcePath: row.source_path,
          chunkIndex: row.chunk_index,
          heading: row.heading,
          startLine: row.start_line,
          endLine: row.end_line,
          tokenEstimate: row.token_estimate,
          contentHash: row.content_hash,
          terms: new Map<string, number>(),
        }
        chunkMap.set(key, chunk)
      }
      if (row.term) chunk.terms.set(row.term, row.frequency as number)
    }
    const chunks = [...chunkMap.values()].sort(
      (a, b) => a.sourcePath.localeCompare(b.sourcePath) || a.chunkIndex - b.chunkIndex,
    )
    return { documents, chunks }
  } catch (err) {
    throw new IndexStoreError(`could not read sqlite index: ${String(err)}`)
  } finally {
    conn.close()
  }
}

function loadReusableChunks(dbPath: string): Map<string, ReusableEntry> {
  const empty = new Map<string, ReusableEntry>()
  if (!existsSync(dbPath)) return empty
  try {
    const probe = new Database(dbPath, { readonly: true })
    const version = probe.pragma('user_version', { simple: true }) as number
    probe.close()
    if (version !== INDEX_VERSION) return empty
  } catch { return empty }
  let documents: DocumentRow[]
  let chunks: Chunk[]
  try {
    ;({ documents, chunks } = readChunksFromDb(dbPath))
  } catch { return empty }
  const byPath = new Map<string, ReusableEntry>()
  for (const doc of documents) {
    byPath.set(doc.path, { contentHash: doc.contentHash, title: doc.title, updatedAt: doc.updatedAt, chunks: [] })
  }
  for (const chunk of chunks) {
    byPath.get(chunk.sourcePath)?.chunks.push(chunk)
  }
  for (const entry of byPath.values()) entry.chunks.sort((a, b) => a.chunkIndex - b.chunkIndex)
  return byPath
}

export function buildIndex(sourceRoot: string, dbPath: string, config: EngineConfig, full = false): { documents: number; chunks: number } {
  const generatedAt = utcNow()
  const current: Array<{ sourcePath: string; contentHash: string; text: string }> = []
  for (const abs of scanMarkdownFiles(sourceRoot)) {
    let text: string
    try {
      text = readFileSync(abs, 'utf8')
    } catch (err) {
      throw new FileSystemError(`could not read markdown file ${abs}: ${String(err)}`)
    }
    current.push({ sourcePath: toSourcePath(sourceRoot, abs), contentHash: sha256Text(text), text })
  }

  const reuse = full ? new Map<string, ReusableEntry>() : loadReusableChunks(dbPath)
  const docs: DocumentRow[] = []
  const chunks: Chunk[] = []
  for (const { sourcePath, contentHash, text } of current) {
    const cached = reuse.get(sourcePath)
    if (cached && cached.contentHash === contentHash) {
      docs.push({ path: sourcePath, title: cached.title, contentHash, updatedAt: cached.updatedAt })
      chunks.push(...cached.chunks)
    } else {
      docs.push({ path: sourcePath, title: titleFromText(sourcePath, text), contentHash, updatedAt: generatedAt })
      chunks.push(...chunksForFile(sourcePath, text, config))
    }
  }

  mkdirSync(dirname(dbPath), { recursive: true })
  const rand = randomBytes(4).toString('hex')
  const tmpPath = join(dirname(dbPath), `${dbPath.split(/[\\/]/).pop()}.${process.pid}.${rand}.tmp`)
  try {
    if (existsSync(tmpPath)) rmSync(tmpPath, { force: true })
    const conn = new Database(tmpPath)
    try {
      conn.pragma('foreign_keys = ON')
      conn.exec(SCHEMA_SQL)
      conn.pragma(`user_version = ${INDEX_VERSION}`)
      const insertDoc = conn.prepare('INSERT INTO documents(path, title, content_hash, updated_at) VALUES (?, ?, ?, ?)')
      const insertChunk = conn.prepare('INSERT INTO chunks(document_id, chunk_index, heading, start_line, end_line, token_estimate, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?)')
      const insertTerm = conn.prepare('INSERT INTO terms(chunk_id, term, frequency) VALUES (?, ?, ?)')
      const run = conn.transaction(() => {
        const docIds = new Map<string, number>()
        for (const doc of docs) {
          const info = insertDoc.run(doc.path, doc.title, doc.contentHash, doc.updatedAt)
          docIds.set(doc.path, Number(info.lastInsertRowid))
        }
        for (const chunk of chunks) {
          const info = insertChunk.run(
            docIds.get(chunk.sourcePath), chunk.chunkIndex, chunk.heading,
            chunk.startLine, chunk.endLine, chunk.tokenEstimate, chunk.contentHash,
          )
          const chunkId = Number(info.lastInsertRowid)
          for (const term of [...chunk.terms.keys()].sort()) {
            insertTerm.run(chunkId, term, chunk.terms.get(term))
          }
        }
      })
      run()
    } finally {
      conn.close()
    }
    // Fix 1: Windows-safe atomic rename — retry up to 3 times on EPERM/EBUSY
    let lastRenameErr: unknown
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        renameSync(tmpPath, dbPath)
        lastRenameErr = undefined
        break
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code
        if ((code === 'EPERM' || code === 'EBUSY') && attempt < 3) {
          // Synchronous busy-wait backoff: 10ms * 2^attempt (10, 20, 40ms)
          const waitMs = 10 * (1 << attempt)
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs)
          lastRenameErr = e
        } else {
          lastRenameErr = e
          break
        }
      }
    }
    if (lastRenameErr !== undefined) throw lastRenameErr
  } catch (err) {
    try { if (existsSync(tmpPath)) rmSync(tmpPath, { force: true }) } catch { /* ignore */ }
    throw new IndexStoreError(`could not rebuild sqlite index: ${String(err)}`)
  }
  return { documents: docs.length, chunks: chunks.length }
}

export function currentDocumentHashes(sourceRoot: string): Map<string, string> {
  const hashes = new Map<string, string>()
  for (const abs of scanMarkdownFiles(sourceRoot)) {
    let text: string
    try {
      text = readFileSync(abs, 'utf8')
    } catch (err) {
      throw new FileSystemError(`could not read markdown file ${abs}: ${String(err)}`)
    }
    hashes.set(toSourcePath(sourceRoot, abs), sha256Text(text))
  }
  return hashes
}

export function indexIsFresh(sourceRoot: string, dbPath: string): boolean {
  if (!existsSync(dbPath)) return false
  const current = currentDocumentHashes(sourceRoot)
  let stored: Map<string, string>
  try {
    const conn = new Database(dbPath, { readonly: true })
    // Fix 3: version mismatch forces a rebuild even when content hashes are unchanged
    const version = conn.pragma('user_version', { simple: true }) as number
    if (version !== INDEX_VERSION) { conn.close(); return false }
    const rows = conn.prepare('SELECT path, content_hash FROM documents').all() as Array<{ path: string; content_hash: string }>
    conn.close()
    stored = new Map(rows.map(r => [r.path, r.content_hash]))
  } catch { return false }
  if (stored.size !== current.size) return false
  for (const [path, hash] of current) {
    if (stored.get(path) !== hash) return false
  }
  return true
}
