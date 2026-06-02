export type SkillSource = 'builtin-auto' | 'builtin-opt-in' | 'user'

export interface SkillDefinition {
  name: string
  description: string
  whenToUse?: string
  source: SkillSource
  path: string
  body: string
}

export interface SkillIndex {
  name: string
  description: string
  whenToUse?: string
  source: SkillSource
}

export function toIndex(s: SkillDefinition): SkillIndex {
  return { name: s.name, description: s.description, whenToUse: s.whenToUse, source: s.source }
}
