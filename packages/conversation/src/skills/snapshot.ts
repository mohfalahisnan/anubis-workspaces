import type { ResolvedProfile } from '../profiles/types.js'
import type { SkillDefinition } from './types.js'

export function computeInitialSkills(
  allSkills: SkillDefinition[],
  profile: Pick<ResolvedProfile, 'enabledSkills' | 'disabledBuiltinSkills'> & { agent: ResolvedProfile['agent'] },
): string[] {
  const disabled = new Set(profile.disabledBuiltinSkills ?? [])
  const autoInject = allSkills
    .filter(s => s.source === 'builtin-auto' || s.source === 'user-auto')
    .map(s => s.name)
    .filter(n => !disabled.has(n))

  const catalog = new Set(allSkills.map(s => s.name))
  const optIn = (profile.enabledSkills ?? []).filter(n => catalog.has(n))

  return [...new Set([...autoInject, ...optIn])].sort()
}
