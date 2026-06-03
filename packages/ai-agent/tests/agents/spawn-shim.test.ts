import { describe, it, expect } from 'vitest'
import { quoteWindowsArg } from '../../src/agents/spawn-shim.js'

/**
 * Regression: a prompt like "get out the plan mode" was getting split by
 * cmd.exe into separate tokens because Node's `shell: true` doesn't quote
 * args. The Claude CLI then only saw the first word as `-p` value. Our
 * Windows quoter must wrap multi-word args so cmd.exe's parser treats
 * them as one token.
 */
describe('quoteWindowsArg', () => {
  it('passes simple identifiers through unchanged', () => {
    expect(quoteWindowsArg('claude')).toBe('claude')
    expect(quoteWindowsArg('-p')).toBe('-p')
    expect(quoteWindowsArg('app-server')).toBe('app-server')
  })

  it('returns an empty quoted token for empty input', () => {
    expect(quoteWindowsArg('')).toBe('""')
  })

  it('wraps multi-word prompts in double quotes (the original bug)', () => {
    expect(quoteWindowsArg('get out the plan mode')).toBe('"get out the plan mode"')
  })

  it('escapes embedded double quotes', () => {
    expect(quoteWindowsArg('he said "hi"')).toBe('"he said \\"hi\\""')
  })

  it('passes a plain Windows path through without quoting (no spaces/metachars)', () => {
    expect(quoteWindowsArg('C:\\foo\\')).toBe('C:\\foo\\')
  })

  it('doubles trailing backslashes when the arg needs quoting (has spaces)', () => {
    // A path with a space MUST be quoted, and the trailing `\` before the
    // closing `"` would otherwise escape that `"`. Double it.
    expect(quoteWindowsArg('C:\\Program Files\\foo\\')).toBe('"C:\\Program Files\\foo\\\\"')
  })

  it('quotes args that contain cmd metachars even without spaces', () => {
    expect(quoteWindowsArg('a&b')).toBe('"a&b"')
    expect(quoteWindowsArg('x|y')).toBe('"x|y"')
    expect(quoteWindowsArg('100%')).toBe('"100%"')
  })

  it('preserves backslashes that do not precede a quote', () => {
    expect(quoteWindowsArg('a\\b\\c')).toBe('a\\b\\c')
  })
})
