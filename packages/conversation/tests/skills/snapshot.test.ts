import { describe, it, expect } from 'vitest'
import { computeInitialSkills } from '../../src/skills/snapshot.js'
import type { SkillDefinition } from '../../src/skills/types.js'

const skill = (name: string, source: SkillDefinition['source']): SkillDefinition => ({
  name, description: '', source, path: '/x', body: '',
})

describe('computeInitialSkills', () => {
  it('includes every auto-inject by default', () => {
    const skills = [skill('a', 'builtin-auto'), skill('b', 'builtin-auto')]
    expect(computeInitialSkills(skills, { agent: 'claude' })).toEqual(['a', 'b'])
  })

  it('auto-injects user-auto skills alongside builtin-auto', () => {
    const skills = [skill('a', 'builtin-auto'), skill('u', 'user-auto')]
    expect(computeInitialSkills(skills, { agent: 'claude' })).toEqual(['a', 'u'])
  })

  it('excludes disabledBuiltinSkills (including user-auto by name)', () => {
    const skills = [skill('a', 'builtin-auto'), skill('b', 'builtin-auto'), skill('u', 'user-auto')]
    const out = computeInitialSkills(skills, { agent: 'claude', disabledBuiltinSkills: ['a', 'u'] })
    expect(out).toEqual(['b'])
  })

  it('includes enabledSkills when they exist in catalog', () => {
    const skills = [skill('a', 'builtin-auto'), skill('opt', 'builtin-opt-in'), skill('usr', 'user')]
    const out = computeInitialSkills(skills, { agent: 'claude', enabledSkills: ['opt', 'usr', 'missing'] })
    expect(out).toEqual(['a', 'opt', 'usr'])
  })

  it('deduplicates and sorts', () => {
    const skills = [skill('z', 'builtin-auto'), skill('a', 'builtin-auto'), skill('m', 'builtin-opt-in')]
    const out = computeInitialSkills(skills, { agent: 'claude', enabledSkills: ['a', 'm'] })
    expect(out).toEqual(['a', 'm', 'z'])
  })
})
