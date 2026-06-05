import { describe, it, expect } from 'vitest'
import { forbiddenPhraseViolations } from '../../src/validators/helpers.js'

describe('forbiddenPhraseViolations', () => {
  it('flags an "avoid X" rule when X appears in the output', () => {
    const hits = forbiddenPhraseViolations(
      ['avoid fear-based hooks', 'no medical claims'],
      'This opens with fear-based hooks for impact.',
    )
    expect(hits).toContain('fear-based hooks')
  })

  it('returns nothing when no rule is matched', () => {
    expect(forbiddenPhraseViolations(['avoid hype'], 'a calm educational caption')).toEqual([])
  })

  it('ignores rules with no parseable forbidden phrase', () => {
    expect(forbiddenPhraseViolations(['be professional'], 'anything')).toEqual([])
  })
})
