import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { buildIndex, readChunksFromDb, indexIsFresh } from './index-store.js'
import { DEFAULT_CONFIG, INDEX_VERSION } from './config.js'

let src: string
let db: string
beforeEach(() => {
  const tmp = mkdtempSync(join(tmpdir(), 'kl-store-'))
  src = join(tmp, 'knowledge')
  db = join(tmp, 'index.db')
  mkdirSync(src, { recursive: true })
})
afterEach(() => { rmSync(join(src, '..'), { recursive: true, force: true }) })

function write(rel: string, text: string): void {
  const p = join(src, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, text, 'utf8')
}

function snapshot(): unknown {
  const conn = new Database(db, { readonly: true })
  try {
    return {
      docs: conn.prepare('SELECT path, title, content_hash FROM documents ORDER BY path').all(),
      chunks: conn.prepare('SELECT d.path, c.chunk_index, c.heading, c.start_line, c.end_line, c.token_estimate, c.content_hash FROM chunks c JOIN documents d ON d.id = c.document_id ORDER BY d.path, c.chunk_index').all(),
      terms: conn.prepare('SELECT d.path, c.chunk_index, t.term, t.frequency FROM terms t JOIN chunks c ON c.id = t.chunk_id JOIN documents d ON d.id = c.document_id ORDER BY d.path, c.chunk_index, t.term').all(),
    }
  } finally { conn.close() }
}

describe('buildIndex', () => {
  it('incremental result equals a full rebuild after change/add/delete', () => {
    write('a.md', '# A\n\nalpha shared word\n')
    write('b.md', '# B\n\nbeta shared word\n')
    write('c.md', '# C\n\ngamma shared word\n')
    buildIndex(src, db, DEFAULT_CONFIG)
    write('a.md', '# A\n\nalpha shared word extra epsilon\n')
    write('d.md', '# D\n\ndelta shared word\n')
    rmSync(join(src, 'c.md'))
    buildIndex(src, db, DEFAULT_CONFIG)
    const incremental = snapshot()

    // Fresh full rebuild of the final file set in a second store.
    const tmp2 = mkdtempSync(join(tmpdir(), 'kl-store2-'))
    const src2 = join(tmp2, 'knowledge'); const db2 = join(tmp2, 'index.db')
    mkdirSync(src2, { recursive: true })
    const w2 = (rel: string, t: string) => { const p = join(src2, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, t, 'utf8') }
    w2('a.md', '# A\n\nalpha shared word extra epsilon\n')
    w2('b.md', '# B\n\nbeta shared word\n')
    w2('d.md', '# D\n\ndelta shared word\n')
    buildIndex(src2, db2, DEFAULT_CONFIG, true)
    const conn = new Database(db2, { readonly: true })
    const full = {
      docs: conn.prepare('SELECT path, title, content_hash FROM documents ORDER BY path').all(),
      chunks: conn.prepare('SELECT d.path, c.chunk_index, c.heading, c.start_line, c.end_line, c.token_estimate, c.content_hash FROM chunks c JOIN documents d ON d.id = c.document_id ORDER BY d.path, c.chunk_index').all(),
      terms: conn.prepare('SELECT d.path, c.chunk_index, t.term, t.frequency FROM terms t JOIN chunks c ON c.id = t.chunk_id JOIN documents d ON d.id = c.document_id ORDER BY d.path, c.chunk_index, t.term').all(),
    }
    conn.close()
    rmSync(tmp2, { recursive: true, force: true })

    expect(incremental).toEqual(full)
  })

  it('sets user_version and indexIsFresh tracks file hashes', () => {
    write('a.md', '# A\n\nalpha content here\n')
    buildIndex(src, db, DEFAULT_CONFIG)
    const conn = new Database(db, { readonly: true })
    expect(conn.pragma('user_version', { simple: true })).toBe(INDEX_VERSION)
    conn.close()
    expect(indexIsFresh(src, db)).toBe(true)
    write('a.md', '# A\n\nalpha content here changed\n')
    expect(indexIsFresh(src, db)).toBe(false)
  })

  it('readChunksFromDb returns docs and chunks with terms', () => {
    write('a.md', '# A\n\nalpha beta alpha\n')
    buildIndex(src, db, DEFAULT_CONFIG)
    const { documents, chunks } = readChunksFromDb(db)
    expect(documents).toHaveLength(1)
    expect(chunks[0].terms.get('alpha')).toBe(2)
  })
})
