import { describe, it, expect } from 'vitest'
import { parseEnvelope } from '../../src/executors/_envelope.js'

describe('parseEnvelope', () => {
  it('parses the standard envelope from a fenced anubis-output block', () => {
    const reply = 'some prose\n```anubis-output\n{"text":"hi","data":{"x":1},"paths":["/tmp/a"]}\n```\n'
    expect(parseEnvelope(reply)).toEqual({
      text: 'hi',
      data: { x: 1 },
      paths: ['/tmp/a'],
    })
  })

  it('returns the LAST fenced block when multiple are present', () => {
    const reply = '```anubis-output\n{"text":"draft"}\n```\n\n```anubis-output\n{"text":"final"}\n```\n'
    expect(parseEnvelope(reply)).toEqual({ text: 'final', data: undefined, paths: undefined })
  })

  it('falls back to whole-reply-as-text when no fence present', () => {
    const reply = 'just some plain text answer\nwith newlines'
    expect(parseEnvelope(reply)).toEqual({
      text: 'just some plain text answer\nwith newlines',
      data: undefined,
      paths: undefined,
    })
  })

  it('falls back to whole-reply when fenced JSON is malformed', () => {
    const reply = '```anubis-output\nnot json at all\n```'
    const out = parseEnvelope(reply)
    expect(out.text).toContain('not json at all')
    expect(out.data).toBeUndefined()
    expect(out.paths).toBeUndefined()
  })

  it('preserves nested data shape exactly', () => {
    const reply = '```anubis-output\n{"text":"ok","data":{"nested":{"arr":[1,2,3]}}}\n```'
    expect(parseEnvelope(reply).data).toEqual({ nested: { arr: [1, 2, 3] } })
  })

  it('filters non-string entries out of paths', () => {
    const reply = '```anubis-output\n{"text":"ok","paths":["/a", 42, null, "/b"]}\n```'
    expect(parseEnvelope(reply).paths).toEqual(['/a', '/b'])
  })

  it('omits paths field entirely when not an array', () => {
    const reply = '```anubis-output\n{"text":"ok","paths":"oops"}\n```'
    expect(parseEnvelope(reply).paths).toBeUndefined()
  })
})
