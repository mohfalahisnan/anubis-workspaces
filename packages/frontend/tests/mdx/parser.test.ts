import { describe, it, expect } from 'vitest'
import { splitMdxSource } from '@/components/mdx/parser'

describe('splitMdxSource', () => {
  it('returns a single markdown segment for plain text', () => {
    expect(splitMdxSource('hello **world**')).toEqual([
      { kind: 'markdown', text: 'hello **world**' },
    ])
  })

  it('treats non-whitelisted tags as plain markdown text', () => {
    const out = splitMdxSource('see <Foo bar="1" />')
    expect(out).toEqual([{ kind: 'markdown', text: 'see <Foo bar="1" />' }])
  })

  it('splits a single whitelisted self-closing component', () => {
    const out = splitMdxSource('before <DataTable columns={["a"]} rows={[["1"]]} /> after')
    expect(out).toHaveLength(3)
    expect(out[0]).toEqual({ kind: 'markdown', text: 'before ' })
    expect(out[1]).toMatchObject({
      kind: 'component',
      name: 'DataTable',
      childrenRaw: '',
    })
    expect((out[1] as { propsRaw: string }).propsRaw).toContain('columns={["a"]}')
    expect(out[2]).toEqual({ kind: 'markdown', text: ' after' })
  })

  it('splits a whitelisted block component with children', () => {
    const out = splitMdxSource('q? <Buttons><Button send="yes">Yes</Button></Buttons> done')
    expect(out).toHaveLength(3)
    expect(out[1]).toMatchObject({
      kind: 'component',
      name: 'Buttons',
      propsRaw: '',
      childrenRaw: '<Button send="yes">Yes</Button>',
    })
  })

  it('does not treat < inside a string prop as a new tag', () => {
    const out = splitMdxSource('<Button send="a<b">x</Button>')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'component', name: 'Button' })
    expect((out[0] as { propsRaw: string }).propsRaw).toBe('send="a<b"')
  })

  it('handles { } JSON props with nested braces and quoted strings', () => {
    const src = '<DataTable columns={["a","b"]} rows={[[1,2],[3,4]]} />'
    const out = splitMdxSource(src)
    expect(out).toHaveLength(1)
    expect((out[0] as { propsRaw: string }).propsRaw).toBe('columns={["a","b"]} rows={[[1,2],[3,4]]}')
  })

  it('flushes an unclosed whitelisted tag at end of input as trailing markdown', () => {
    const partial = 'before <Buttons><Button send="ye'
    const out = splitMdxSource(partial)
    expect(out).toEqual([{ kind: 'markdown', text: partial }])
  })

  it('closes the tag once the next chunk completes it', () => {
    const full = 'before <Buttons><Button send="yes">Yes</Button></Buttons>'
    const out = splitMdxSource(full)
    expect(out).toHaveLength(2)
    expect(out[1]).toMatchObject({ kind: 'component', name: 'Buttons' })
  })

  it('handles two whitelisted components in sequence', () => {
    const out = splitMdxSource('<Button send="a">A</Button><Button send="b">B</Button>')
    expect(out).toHaveLength(2)
    expect(out.every((s) => s.kind === 'component')).toBe(true)
  })
})
