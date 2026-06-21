import { describe, it, expect } from 'vitest'
import { resolve, join } from 'node:path'
import { rejectBadDocumentPath, resolveTargetPath } from './paths.js'
import { ValidationError } from './types.js'

describe('rejectBadDocumentPath', () => {
  it('accepts a clean relative .md path', () => {
    expect(rejectBadDocumentPath('brand/voice.md')).toBe('brand/voice.md')
  })
  it('rejects empty, absolute, drive, .., and non-md', () => {
    expect(() => rejectBadDocumentPath('')).toThrow(ValidationError)
    expect(() => rejectBadDocumentPath('/etc/x.md')).toThrow(ValidationError)
    expect(() => rejectBadDocumentPath('C:/x.md')).toThrow(ValidationError)
    expect(() => rejectBadDocumentPath('../x.md')).toThrow(ValidationError)
    expect(() => rejectBadDocumentPath('notes.txt')).toThrow(ValidationError)
  })
})

describe('resolveTargetPath', () => {
  it('resolves inside sourceRoot', () => {
    const root = resolve('/tmp/k')
    expect(resolveTargetPath(root, 'a/b.md')).toBe(join(root, 'a', 'b.md'))
  })
  it('rejects traversal that escapes sourceRoot', () => {
    expect(() => resolveTargetPath(resolve('/tmp/k'), 'a/../../b.md')).toThrow(ValidationError)
  })
})
