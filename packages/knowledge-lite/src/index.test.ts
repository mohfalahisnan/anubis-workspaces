import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEngine } from './index.js'
import { ValidationError } from './types.js'

let sourceRoot: string; let dbPath: string
beforeEach(() => { const tmp = mkdtempSync(join(tmpdir(), 'kl-api-')); sourceRoot = join(tmp, 'knowledge'); dbPath = join(tmp, 'db', 'index.db'); mkdirSync(sourceRoot, { recursive: true }) })
afterEach(() => { rmSync(join(sourceRoot, '..'), { recursive: true, force: true }) })

describe('createEngine', () => {
  it('save writes markdown under sourceRoot and indexes it; search finds it lazily', () => {
    const engine = createEngine({ sourceRoot, dbPath })
    engine.save({ path: 'brand/voice.md', content: '# Brand Voice\n\nwarm confident concise tone\n' })
    expect(existsSync(join(sourceRoot, 'brand', 'voice.md'))).toBe(true)
    const r = engine.search({ query: 'confident tone' })
    expect(r.results[0].source).toBe('brand/voice.md')
    expect(r.results[0].excerpt).toContain('warm confident')
  })

  it('save rejects overwrite without force; update requires existing; delete removes + reindexes', () => {
    const engine = createEngine({ sourceRoot, dbPath })
    engine.save({ path: 'a.md', content: '# A\n\nalpha\n' })
    expect(() => engine.save({ path: 'a.md', content: '# A2\n\nbeta\n' })).toThrow(ValidationError)
    engine.update({ path: 'a.md', content: '# A2\n\nbeta gamma\n' })
    expect(readFileSync(join(sourceRoot, 'a.md'), 'utf8')).toContain('beta gamma')
    engine.delete({ path: 'a.md' })
    expect(existsSync(join(sourceRoot, 'a.md'))).toBe(false)
    expect(engine.search({ query: 'beta' }).results).toEqual([])
  })

  it('stats and listDocuments report the corpus', () => {
    const engine = createEngine({ sourceRoot, dbPath })
    engine.save({ path: 'a.md', content: '# A\n\nalpha beta\n' })
    const stats = engine.stats()
    expect(stats.documentCount).toBe(1)
    expect(stats.chunkCount).toBeGreaterThanOrEqual(1)
    expect(engine.listDocuments().items[0].path).toBe('a.md')
  })
})
