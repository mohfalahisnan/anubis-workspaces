import type { SkillDefinition } from './types.js'

export function buildSkillsBlock(skills: SkillDefinition[]): string {
  if (skills.length === 0) return ''
  return [
    '## Available Skills',
    'You have access to the following skills. Apply them when relevant.',
    '',
    ...skills.map(s => `### ${s.name}\n${s.body.trim()}`),
  ].join('\n\n')
}

export function composeAppendSystemPrompt(
  profilePrompt: string | undefined,
  skills: SkillDefinition[],
): string | undefined {
  const block = buildSkillsBlock(skills)
  const parts = [profilePrompt?.trim(), block].filter((s): s is string => Boolean(s && s.length))
  return parts.length > 0 ? parts.join('\n\n') : undefined
}
