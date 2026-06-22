import { describe, it, expect } from 'vitest'
import { normalizeTerms, stemTerm, estimateTokens, cleanHeading, titleFromText } from './text.js'

describe('normalizeTerms', () => {
  it('drops short tokens and stopwords, lowercases, stems', () => {
    expect(normalizeTerms('We Build Workflows and Automations')).toEqual(
      ['build', 'workflow', 'automation'],
    )
  })
  it('stems plurals/inflections consistently', () => {
    expect(stemTerm('workflows')).toBe('workflow')
    expect(stemTerm('automations')).toBe('automation')
    expect(stemTerm('running')).toBe('run')
  })
  it('collapses singular and plural to the same stem (recall)', () => {
    // Regression: a word ending in -ss is singular, so it must not lose its 's'
    // while its -es plural keeps it (class->clas vs classes->class would never match).
    expect(stemTerm('class')).toBe(stemTerm('classes'))
    expect(stemTerm('process')).toBe(stemTerm('processes'))
    expect(stemTerm('cat')).toBe(stemTerm('cats'))
    expect(stemTerm('party')).toBe(stemTerm('parties'))
  })
  it('collapses verb forms onto the base via undoubling', () => {
    expect(stemTerm('running')).toBe(stemTerm('run'))
    expect(stemTerm('hopped')).toBe(stemTerm('hop'))
    // l/s/z doubles are preserved so falling->fall (not fal)
    expect(stemTerm('falling')).toBe('fall')
    expect(stemTerm('pressing')).toBe('press')
  })
})

describe('estimateTokens', () => {
  it('is words * 1.3, min 1', () => {
    expect(estimateTokens('one two three')).toBe(3) // 3 * 1.3 = 3.9 -> int 3
    expect(estimateTokens('')).toBe(1)
  })
})

describe('cleanHeading / titleFromText', () => {
  it('extracts the first markdown heading', () => {
    expect(cleanHeading('## Hello World')).toBe('Hello World')
    expect(cleanHeading('not a heading')).toBeNull()
    expect(titleFromText('a.md', 'intro\n\n# Real Title\nbody')).toBe('Real Title')
    expect(titleFromText('a.md', 'no heading here')).toBe('a.md')
  })
})
