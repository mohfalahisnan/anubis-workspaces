import { describe, it, expect } from 'vitest'
import { parseProps } from '@/components/mdx/props-parser'

describe('parseProps', () => {
  it('returns empty object for empty input', () => {
    expect(parseProps('')).toEqual({ ok: true, value: {} })
  })

  it('parses a single string prop', () => {
    expect(parseProps('send="hello"')).toEqual({
      ok: true,
      value: { send: 'hello' },
    })
  })

  it('parses a JSON-escaped string', () => {
    expect(parseProps('send="a\\"b"')).toEqual({
      ok: true,
      value: { send: 'a"b' },
    })
  })

  it('parses a JSON expression prop', () => {
    expect(parseProps('columns={["a","b"]}')).toEqual({
      ok: true,
      value: { columns: ['a', 'b'] },
    })
  })

  it('parses mixed string + JSON props', () => {
    expect(parseProps('title="x" data={[{"a":1}]}')).toEqual({
      ok: true,
      value: { title: 'x', data: [{ a: 1 }] },
    })
  })

  it('returns ok:false for an unterminated string', () => {
    expect(parseProps('send="abc')).toMatchObject({ ok: false })
  })

  it('returns ok:false for unbalanced braces', () => {
    expect(parseProps('data={[1,2}')).toMatchObject({ ok: false })
  })

  it('returns ok:false for missing equals', () => {
    expect(parseProps('send "x"')).toMatchObject({ ok: false })
  })

  it('returns ok:false for invalid JSON in braces', () => {
    expect(parseProps('data={[1,2,]}')).toMatchObject({ ok: false })
  })
})
