import { describe, it, expect } from 'vitest'
import { buildSkillsPointer, composeAppendSystemPrompt } from '../../src/skills/inject.js'
import type { ProjectContext } from '../../src/skills/inject.js'
import type { SkillDefinition } from '../../src/skills/types.js'

const skill = (name: string, description = ''): SkillDefinition => ({
  name, description, source: 'builtin-auto', path: '/x', body: 'BODY',
})

const project = (overrides: Partial<ProjectContext> = {}): ProjectContext => ({
  id: 'proj-123',
  name: 'My Project',
  ...overrides,
})

describe('buildSkillsPointer', () => {
  it('returns empty string for empty input', () => {
    expect(buildSkillsPointer([])).toBe('')
  })

  it('emits a header and one pointer line per skill (no bodies)', () => {
    const out = buildSkillsPointer([skill('a', 'does A'), skill('b', 'does B')])
    expect(out).toContain('## Available Skills')
    expect(out).toContain('- **a** (`.agents/skills/a/SKILL.md`) — does A')
    expect(out).toContain('- **b** (`.agents/skills/b/SKILL.md`) — does B')
    expect(out).not.toContain('BODY')
  })

  it('omits the dash when a skill has no description', () => {
    const out = buildSkillsPointer([skill('a')])
    expect(out).toContain('- **a** (`.agents/skills/a/SKILL.md`)')
    expect(out).not.toMatch(/\.agents\/skills\/a\/SKILL\.md`\) —/)
  })
})

describe('composeAppendSystemPrompt', () => {
  it('returns undefined when all inputs are empty', () => {
    expect(composeAppendSystemPrompt(undefined, [])).toBeUndefined()
    expect(composeAppendSystemPrompt('', [])).toBeUndefined()
  })

  it('returns just the profile prompt when no skills or project', () => {
    expect(composeAppendSystemPrompt('be helpful', [])).toBe('be helpful')
  })

  it('joins profile prompt and skills pointer', () => {
    const out = composeAppendSystemPrompt('be helpful', [skill('a', 'does A')])
    expect(out).toContain('be helpful')
    expect(out).toContain('## Available Skills')
  })

  it('injects project name and id when project is provided', () => {
    const out = composeAppendSystemPrompt(undefined, [], project())
    expect(out).toContain('# anubisRuntime')
    expect(out).toContain('**My Project**')
    expect(out).toContain('`proj-123`')
  })

  it('injects the backend URL when provided', () => {
    const out = composeAppendSystemPrompt(undefined, [], project({ backendUrl: 'http://127.0.0.1:4317' }))
    expect(out).toContain('http://127.0.0.1:4317')
    expect(out).toContain('API base URL')
  })

  it('includes workspace path when provided', () => {
    const out = composeAppendSystemPrompt(undefined, [], project({ workspacePath: '/my/workspace' }))
    expect(out).toContain('/my/workspace')
  })

  it('omits workspace path when not provided', () => {
    const out = composeAppendSystemPrompt(undefined, [], project({ workspacePath: undefined }))
    expect(out).not.toContain('Workspace path')
  })

  it('orders: profile prompt → project block → skills pointer', () => {
    const out = composeAppendSystemPrompt('be helpful', [skill('a', 'does A')], project())!
    const profileIdx = out.indexOf('be helpful')
    const projectIdx = out.indexOf('# anubisRuntime')
    const skillsIdx = out.indexOf('## Available Skills')
    expect(profileIdx).toBeLessThan(projectIdx)
    expect(projectIdx).toBeLessThan(skillsIdx)
  })

  it('produces non-empty output when only project is provided', () => {
    const out = composeAppendSystemPrompt(undefined, [], project())
    expect(out).toBeTruthy()
  })
})
