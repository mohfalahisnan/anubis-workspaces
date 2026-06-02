import { describe, it, expect } from 'vitest'
import { buildSkillsBlock, composeAppendSystemPrompt } from '../../src/skills/inject.js'
import type { SkillDefinition } from '../../src/skills/types.js'

const skill = (name: string, body: string): SkillDefinition => ({
  name, description: '', source: 'builtin-auto', path: '/x', body,
})

describe('buildSkillsBlock', () => {
  it('returns empty string for empty input', () => {
    expect(buildSkillsBlock([])).toBe('')
  })

  it('emits a header and one section per skill', () => {
    const out = buildSkillsBlock([skill('a', 'BODY A'), skill('b', 'BODY B')])
    expect(out).toContain('## Available Skills')
    expect(out).toContain('### a')
    expect(out).toContain('BODY A')
    expect(out).toContain('### b')
    expect(out).toContain('BODY B')
  })

  it('strips trailing whitespace from bodies', () => {
    const out = buildSkillsBlock([skill('a', '  BODY  \n\n')])
    expect(out).toContain('BODY')
    expect(out).not.toMatch(/BODY\s+\n###/)
  })
})

describe('composeAppendSystemPrompt', () => {
  it('returns undefined when both are empty', () => {
    expect(composeAppendSystemPrompt(undefined, [])).toBeUndefined()
    expect(composeAppendSystemPrompt('', [])).toBeUndefined()
  })

  it('returns just the profile prompt when no skills', () => {
    expect(composeAppendSystemPrompt('be helpful', [])).toBe('be helpful')
  })

  it('joins profile prompt and skills block', () => {
    const out = composeAppendSystemPrompt('be helpful', [skill('a', 'BODY A')])
    expect(out).toContain('be helpful')
    expect(out).toContain('## Available Skills')
  })
})
