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

export interface ProjectContext {
  id: string
  name: string
  workspacePath?: string
  /** Live Anubis backend base URL, so the agent can call the HTTP API. */
  backendUrl?: string
}

function buildProjectBlock(project: ProjectContext): string {
  const lines = [
    '# anubisRuntime',
    `The active Anubis project is **${project.name}** (id: \`${project.id}\`).`,
    'Use this project id when creating tasks, conversations, content items, or other project-scoped objects via the Anubis API — do not substitute a different project.',
  ]
  if (project.backendUrl) {
    lines.push(`Anubis backend API base URL: \`${project.backendUrl}\` (local HTTP API; e.g. \`GET ${project.backendUrl}/health\`).`)
  }
  if (project.workspacePath) {
    lines.push(`Workspace path: \`${project.workspacePath}\``)
  }
  return lines.join('\n')
}

export function composeAppendSystemPrompt(
  profilePrompt: string | undefined,
  skills: SkillDefinition[],
  project?: ProjectContext,
): string | undefined {
  const projectBlock = project ? buildProjectBlock(project) : ''
  const skillsBlock = buildSkillsPointer(skills)
  const parts = [profilePrompt?.trim(), projectBlock, skillsBlock].filter(
    (s): s is string => Boolean(s && s.length),
  )
  return parts.length > 0 ? parts.join('\n\n') : undefined
}

/**
 * Build a system prompt for web agents (gpt-web, qwen-web) that cannot read
 * files from the filesystem. Inlines full skill bodies instead of file pointers.
 */
export function buildWebAgentSystemPrompt(
  profilePrompt: string | undefined,
  skills: SkillDefinition[],
  project?: ProjectContext,
): string | undefined {
  const projectBlock = project ? buildProjectBlock(project) : ''
  const skillsBlock = skills.length > 0
    ? '## Active Skills\n\n' + skills.map(s => {
        const header = `### ${s.name}${s.description ? ` — ${s.description}` : ''}`
        return `${header}\n\n${s.body.trim()}`
      }).join('\n\n---\n\n')
    : ''
  const parts = [profilePrompt?.trim(), projectBlock, skillsBlock].filter(
    (s): s is string => Boolean(s && s.length),
  )
  return parts.length > 0 ? parts.join('\n\n') : undefined
}
