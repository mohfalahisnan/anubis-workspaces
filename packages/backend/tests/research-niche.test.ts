import { describe, it, expect } from 'vitest'
import { buildNichePrompt, parseNicheVerdicts, validateSessionNiche, type NicheItem } from '../src/research-niche.js'

const items: NicheItem[] = [
  { id: 'r1', caption: 'Full body dumbbell workout at home', competitorHandle: '@fitcoach', competitorNiche: 'Fitness' },
  { id: 'r2', caption: 'My favorite pasta recipe', competitorHandle: '@chef', competitorNiche: 'Food' },
]

describe('buildNichePrompt', () => {
  it('includes each id, caption, and the niche context', () => {
    const p = buildNichePrompt(items, 'We coach home fitness for busy parents.')
    expect(p).toContain('r1')
    expect(p).toContain('dumbbell workout')
    expect(p).toContain('home fitness for busy parents')
    expect(p).toMatch(/JSON array/i)
  })
  it('falls back to a workspace-infer note when no context', () => {
    expect(buildNichePrompt(items)).toMatch(/infer/i)
  })
})

describe('parseNicheVerdicts', () => {
  const ids = new Set(['r1', 'r2'])

  it('parses a plain JSON array', () => {
    const out = parseNicheVerdicts('[{"id":"r1","aligned":true,"reason":"fitness"},{"id":"r2","aligned":false,"reason":"food"}]', ids)
    expect(out).toEqual([
      { id: 'r1', aligned: true, reason: 'fitness' },
      { id: 'r2', aligned: false, reason: 'food' },
    ])
  })
  it('tolerates markdown fences and surrounding prose', () => {
    const text = 'Here are the verdicts:\n```json\n[{"id":"r1","aligned":true,"reason":"ok"}]\n```\nDone.'
    expect(parseNicheVerdicts(text, ids)).toEqual([{ id: 'r1', aligned: true, reason: 'ok' }])
  })
  it('tolerates an object wrapper around the array', () => {
    const text = '{"verdicts":[{"id":"r2","aligned":true,"reason":"x"}]}'
    expect(parseNicheVerdicts(text, ids)).toEqual([{ id: 'r2', aligned: true, reason: 'x' }])
  })
  it('drops unknown ids, coerces aligned (true/"true" only), and defaults a non-string reason', () => {
    const out = parseNicheVerdicts('[{"id":"nope","aligned":true,"reason":"x"},{"id":"r1","aligned":"true","reason":7}]', ids)
    expect(out).toEqual([{ id: 'r1', aligned: true, reason: '' }])
  })
  it('treats ambiguous aligned values as off-niche', () => {
    expect(parseNicheVerdicts('[{"id":"r1","aligned":"maybe","reason":"unsure"}]', ids)).toEqual([
      { id: 'r1', aligned: false, reason: 'unsure' },
    ])
  })
  it('throws when there is no JSON array', () => {
    expect(() => parseNicheVerdicts('the agent refused', ids)).toThrow()
  })
})

describe('validateSessionNiche', () => {
  it('asks once and returns parsed verdicts', async () => {
    let asked = ''
    const verdicts = await validateSessionNiche({
      items,
      nicheContext: 'home fitness',
      ask: async (prompt) => { asked = prompt; return '[{"id":"r1","aligned":true,"reason":"fitness fit"}]' },
    })
    expect(asked).toContain('r1')
    expect(verdicts).toEqual([{ id: 'r1', aligned: true, reason: 'fitness fit' }])
  })
  it('returns [] without asking when there are no items', async () => {
    let called = false
    const out = await validateSessionNiche({ items: [], ask: async () => { called = true; return '[]' } })
    expect(out).toEqual([])
    expect(called).toBe(false)
  })
})
