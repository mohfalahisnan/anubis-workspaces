import { describe, it, expect } from 'vitest'
import { buildSkillsPointer, composeAppendSystemPrompt } from '../../src/skills/inject.js'
import type { SkillDefinition } from '../../src/skills/types.js'

const skill = (name: string, description = ''): SkillDefinition => ({
  name, description, source: 'builtin-auto', path: '/x', body: 'BODY',
})

describe('buildSkillsPointer', () => {
  it('returns empty string for empty input', () => {
    expect(buildSkillsPointer([])).toBe('')
  })

  it('emits a header and one pointer line per skill (no bodies)', () => {
    const out = buildSkillsPointer([skill('a', 'does A'), skill('b', 'does B')])
    expect(out).toContain('## Available Skills')
    expect(out).toContain('- **a** (`skills/a/SKILL.md`) — does A')
    expect(out).toContain('- **b** (`skills/b/SKILL.md`) — does B')
    expect(out).not.toContain('BODY')
  })

  it('omits the dash when a skill has no description', () => {
    const out = buildSkillsPointer([skill('a')])
    expect(out).toContain('- **a** (`skills/a/SKILL.md`)')
    expect(out).not.toMatch(/skills\/a\/SKILL\.md`\) —/)
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

  it('joins profile prompt and skills pointer', () => {
    const out = composeAppendSystemPrompt('be helpful', [skill('a', 'does A')])
    expect(out).toContain('be helpful')
    expect(out).toContain('## Available Skills')
  })
})
