import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanMarkdownFiles, toSourcePath, utcNow } from './fs.js'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'kl-fs-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('scanMarkdownFiles', () => {
  it('finds nested .md files sorted by relative path, ignores non-md', () => {
    mkdirSync(join(root, 'brand'), { recursive: true })
    writeFileSync(join(root, 'brand', 'voice.md'), '# V')
    writeFileSync(join(root, 'a.md'), '# A')
    writeFileSync(join(root, 'note.txt'), 'x')
    const files = scanMarkdownFiles(root)
    expect(files.map(f => toSourcePath(root, f))).toEqual(['a.md', 'brand/voice.md'])
  })
  it('returns [] when sourceRoot is missing', () => {
    expect(scanMarkdownFiles(join(root, 'nope'))).toEqual([])
  })
})

describe('utcNow', () => {
  it('is an ISO Z timestamp', () => {
    expect(utcNow()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  })
})
