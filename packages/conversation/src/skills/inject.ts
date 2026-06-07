import type { SkillDefinition } from './types.js'

/**
 * Compact pointer block listing the skills available to the agent.
 *
 * Skill bodies are materialised as files under `.agents/skills/<name>/SKILL.md`
 * (see writeProfileSkills) and loaded on demand, so this block only
 * names them — it never inlines the full body. Keeps always-on context
 * small while still telling Codex (which doesn't auto-scan the dir)
 * where the skills live.
 */
export function buildSkillsPointer(skills: SkillDefinition[]): string {
  if (skills.length === 0) return ''
  return [
    '## Available Skills',
    'These skills are installed as files under `.agents/skills/<name>/SKILL.md`. Read a skill\'s file when its description matches the task.',
    '',
    ...skills.map(s => {
      const desc = s.description.trim()
      return `- **${s.name}** (\`.agents/skills/${s.name}/SKILL.md\`)${desc ? ` — ${desc}` : ''}`
    }),
  ].join('\n')
}

export function composeAppendSystemPrompt(
  profilePrompt: string | undefined,
  skills: SkillDefinition[],
): string | undefined {
  const block = buildSkillsPointer(skills)
  const parts = [profilePrompt?.trim(), block].filter((s): s is string => Boolean(s && s.length))
  return parts.length > 0 ? parts.join('\n\n') : undefined
}
