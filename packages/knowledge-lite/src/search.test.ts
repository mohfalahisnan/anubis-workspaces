import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseQuery, containsPhrase, proximityFactor, searchIndex, renderSearchResult } from './search.js'
import { buildIndex } from './index-store.js'
import { DEFAULT_CONFIG } from './config.js'

describe('parseQuery', () => {
  it('no quotes -> phrases empty, terms stemmed', () => {
    const { phrases, terms } = parseQuery('workflow automation')
    expect(phrases).toEqual([])
    expect(new Set(terms)).toEqual(new Set(['workflow', 'automation']))
  })
  it('extracts a phrase and keeps its tokens as terms (deduped)', () => {
    const { phrases, terms } = parseQuery('handling "price objection" fast')
    expect(phrases).toEqual([['price', 'objection']])
    expect(new Set(terms)).toEqual(new Set(['handl', 'price', 'objection', 'fast']))
    expect(terms.length).toBe(new Set(terms).size)
  })
  it('normalizes stopwords out of a phrase', () => {
    const { phrases, terms } = parseQuery('"out of stock"')
    expect(phrases).toEqual([['stock']])
    expect(terms).toEqual(['stock'])
  })
})

describe('containsPhrase', () => {
  it('requires adjacent, in-order tokens', () => {
    expect(containsPhrase(['a', 'price', 'objection', 'b'], ['price', 'objection'])).toBe(true)
    expect(containsPhrase(['a', 'objection', 'x', 'price'], ['price', 'objection'])).toBe(false)
    expect(containsPhrase(['anything'], [])).toBe(true)
  })
})

describe('proximityFactor', () => {
  it('adjacent beats scattered, single term is zero', () => {
    const near = proximityFactor(['alpha', 'beta', 'x', 'y', 'z'], ['alpha', 'beta'])
    const far = proximityFactor(['alpha', 'x', 'y', 'z', 'beta'], ['alpha', 'beta'])
    expect(near).toBeGreaterThan(far)
    expect(near).toBeLessThanOrEqual(1)
    expect(proximityFactor(['alpha', 'x', 'alpha'], ['alpha', 'beta'])).toBe(0)
  })
})

describe('searchIndex', () => {
  let src: string; let db: string
  beforeEach(() => { const tmp = mkdtempSync(join(tmpdir(), 'kl-search-')); src = join(tmp, 'k'); db = join(tmp, 'i.db'); mkdirSync(src, { recursive: true }) })
  afterEach(() => { rmSync(join(src, '..'), { recursive: true, force: true }) })
  const write = (rel: string, t: string) => { const p = join(src, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, t, 'utf8') }
  const index = (files: Record<string, string>) => { for (const [k, v] of Object.entries(files)) write(k, v); buildIndex(src, db, DEFAULT_CONFIG) }

  it('matches stemmed plural forms', () => {
    index({ 'w.md': '# Work\n\nwe build workflows and automations every morning\n' })
    const r = searchIndex(src, db, 'workflow automation', DEFAULT_CONFIG)
    expect(r[0].source).toBe('w.md')
  })
  it('full coverage outranks high-frequency partial', () => {
    index({ 'a.md': '# A\n\napple banana\n', 'b.md': '# B\n\napple apple apple apple apple apple\n' })
    const r = searchIndex(src, db, 'apple banana', DEFAULT_CONFIG)
    expect(r[0].source).toBe('a.md')
  })
  it('rare term outranks common term (IDF)', () => {
    index({
      'rare.md': '# Rare\n\nzebra padding word\n', 'common.md': '# Common\n\nalpha padding word\n',
      'x1.md': '# X1\n\nalpha filler\n', 'x2.md': '# X2\n\nalpha filler\n', 'x3.md': '# X3\n\nalpha filler\n',
    })
    const paths = searchIndex(src, db, 'zebra alpha', DEFAULT_CONFIG).map(r => r.source)
    expect(paths.indexOf('rare.md')).toBeLessThan(paths.indexOf('common.md'))
  })
  it('shorter chunk outranks longer with equal tf', () => {
    index({ 'short.md': '# Short\n\nmango mango\n', 'long.md': '# Long\n\nmango mango ' + 'filler '.repeat(40) + '\n' })
    expect(searchIndex(src, db, 'mango', DEFAULT_CONFIG)[0].source).toBe('short.md')
  })
  it('proximity orders adjacent above scattered', () => {
    index({ 'near.md': '# Near\n\nalpha beta padding padding padding padding\n', 'far.md': '# Far\n\nalpha padding padding beta padding padding\n' })
    expect(searchIndex(src, db, 'alpha beta', DEFAULT_CONFIG)[0].source).toBe('near.md')
  })
  it('quoted phrase excludes scattered match', () => {
    index({ 'hit.md': '# Hit\n\nprice objection handling tips\n', 'miss.md': '# Miss\n\nobjection about the price today\n' })
    const paths = searchIndex(src, db, '"price objection"', DEFAULT_CONFIG).map(r => r.source)
    expect(paths).toContain('hit.md')
    expect(paths).not.toContain('miss.md')
  })
  it('normalizes scores to [0,1] with top = 1', () => {
    index({ 'a.md': '# A\n\nalpha beta gamma\n', 'b.md': '# B\n\nalpha delta\n' })
    const r = searchIndex(src, db, 'alpha beta', DEFAULT_CONFIG)
    expect(r[0].score).toBeCloseTo(1.0)
    for (const x of r) { expect(x.score).toBeGreaterThanOrEqual(0); expect(x.score).toBeLessThanOrEqual(1) }
  })
  it('weak top hit renders a Low confidence note', () => {
    index({ 'a.md': '# A\n\nalpha alpha alpha\n', 'b.md': '# B\n\nalpha content\n' })
    const r = searchIndex(src, db, 'alpha beta gamma', DEFAULT_CONFIG)
    expect(r[0].coverage).toBeLessThan(0.5)
    expect(renderSearchResult('alpha beta gamma', r)).toContain('Low confidence')
  })
  it('empty index returns no results', () => {
    index({})
    expect(searchIndex(src, db, 'alpha', DEFAULT_CONFIG)).toEqual([])
  })
})
