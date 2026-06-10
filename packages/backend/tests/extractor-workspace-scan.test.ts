import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scanWorkspaceFiles } from '../src/extractor.js'

/* Exercises the `.anubisignore`-aware workspace scanner used by the
   workspace-extraction background job. */

let root: string

function touch(rel: string): void {
  const abs = join(root, rel)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, '')
}

function rels(paths: { path: string }[]): string[] {
  return paths.map((p) => p.path.slice(root.length + 1).split('\\').join('/')).sort()
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'anubis-scan-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('scanWorkspaceFiles', () => {
  it('finds images and media by extension', () => {
    touch('a.png')
    touch('docs/b.jpg')
    touch('clip.mp4')
    touch('voice.m4a')
    touch('notes.txt') // not a media file → excluded

    const out = scanWorkspaceFiles(root, { images: true, media: true })
    expect(rels(out)).toEqual(['a.png', 'clip.mp4', 'docs/b.jpg', 'voice.m4a'])
    expect(out.find((f) => f.path.endsWith('a.png'))?.kind).toBe('ocr')
    expect(out.find((f) => f.path.endsWith('clip.mp4'))?.kind).toBe('transcribe')
  })

  it('honors the kind toggles', () => {
    touch('a.png')
    touch('clip.mp4')

    expect(rels(scanWorkspaceFiles(root, { images: true, media: false }))).toEqual(['a.png'])
    expect(rels(scanWorkspaceFiles(root, { images: false, media: true }))).toEqual(['clip.mp4'])
  })

  it('always skips node_modules and .git even without an ignore file', () => {
    touch('keep.png')
    touch('node_modules/pkg/dep.png')
    touch('.git/objects/x.png')

    expect(rels(scanWorkspaceFiles(root, { images: true, media: true }))).toEqual(['keep.png'])
  })

  it('prunes directories listed in .anubisignore', () => {
    writeFileSync(join(root, '.anubisignore'), 'dist/\nbuild/\n')
    touch('src/a.png')
    touch('dist/b.png')
    touch('build/c.png')

    expect(rels(scanWorkspaceFiles(root, { images: true, media: true }))).toEqual(['src/a.png'])
  })

  it('keeps media that matches a selected extension even if .anubisignore globs it out', () => {
    // The default ignore file lists `*.mp4`; selecting media must override it.
    writeFileSync(join(root, '.anubisignore'), '*.mp4\n')
    touch('clip.mp4')
    touch('photo.png')

    const out = scanWorkspaceFiles(root, { images: true, media: true })
    expect(rels(out)).toEqual(['clip.mp4', 'photo.png'])
  })
})
