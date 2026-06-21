import { describe, it, expect } from 'vitest'
import { chunksForFile, splitSections } from './chunking.js'
import { DEFAULT_CONFIG } from './config.js'

describe('splitSections', () => {
  it('splits by headings and keeps line ranges', () => {
    const lines = ['# A', 'alpha', '', '## B', 'beta']
    const sections = splitSections(lines, 'f.md')
    expect(sections.map(s => s.heading)).toEqual(['A', 'B'])
    expect(sections[0].startLine).toBe(1)
    expect(sections[1].startLine).toBe(4)
  })
  it('uses the file name as the heading when there are no headings', () => {
    const sections = splitSections(['just', 'body'], 'f.md')
    expect(sections).toHaveLength(1)
    expect(sections[0].heading).toBe('f.md')
    expect(sections[0].endLine).toBe(2)
  })
})

describe('chunksForFile', () => {
  it('produces one chunk for a small section with normalized terms', () => {
    const chunks = chunksForFile('a.md', '# Work\n\nalpha beta alpha', DEFAULT_CONFIG)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].heading).toBe('Work')
    expect(chunks[0].terms.get('alpha')).toBe(2)
    expect(chunks[0].startLine).toBe(1)
  })
})
