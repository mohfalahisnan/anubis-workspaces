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
    expect(stemTerm('running')).toBe('runn')
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
