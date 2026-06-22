import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEngine } from './index.js'
import { ValidationError } from './types.js'

let sourceRoot: string; let dbPath: string
beforeEach(() => {
  const tmp = mkdtempSync(join(tmpdir(), 'kl-files-'))
  sourceRoot = join(tmp, 'knowledge')
  dbPath = join(tmp, 'db', 'index.db')
  mkdirSync(sourceRoot, { recursive: true })
})
afterEach(() => { rmSync(join(sourceRoot, '..'), { recursive: true, force: true }) })

describe('listFiles', () => {
  it('returns every markdown file on disk, including un-ingested ones', () => {
    const engine = createEngine({ sourceRoot, dbPath })
    mkdirSync(join(sourceRoot, 'brand'), { recursive: true })
    writeFileSync(join(sourceRoot, 'brand', 'voice.md'), '# Voice\n\nwarm\n', 'utf8')
    writeFileSync(join(sourceRoot, 'root.md'), '# Root\n\ntext\n', 'utf8')
    // deliberately never call ingest()
    const { items } = engine.listFiles()
    const paths = items.map((i) => i.path)
    expect(paths).toContain('brand/voice.md')
    expect(paths).toContain('root.md')
    const voice = items.find((i) => i.path === 'brand/voice.md')!
    expect(voice.size).toBeGreaterThan(0)
    expect(typeof voice.updatedAt).toBe('string')
  })

  it('returns an empty list when the corpus is empty', () => {
    const engine = createEngine({ sourceRoot, dbPath })
    expect(engine.listFiles().items).toEqual([])
  })
})

describe('readFile', () => {
  it('returns the raw content of an existing markdown file', () => {
    const engine = createEngine({ sourceRoot, dbPath })
    engine.save({ path: 'brand/voice.md', content: '# Voice\n\nwarm confident\n' })
    const out = engine.readFile({ path: 'brand/voice.md' })
    expect(out.path).toBe('brand/voice.md')
    expect(out.content).toContain('warm confident')
  })

  it('throws ValidationError for a missing file', () => {
    const engine = createEngine({ sourceRoot, dbPath })
    expect(() => engine.readFile({ path: 'nope.md' })).toThrow(ValidationError)
  })

  it('rejects path traversal and non-markdown paths', () => {
    const engine = createEngine({ sourceRoot, dbPath })
    expect(() => engine.readFile({ path: '../escape.md' })).toThrow(ValidationError)
    expect(() => engine.readFile({ path: 'notes.txt' })).toThrow(ValidationError)
  })
})
