import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getBuiltinSkillRoots } from '@anubis/ai-agent'
import { createConversationService, type ConversationStack } from '../src/index.js'

let stack: ConversationStack | null = null
let dir: string | null = null

afterEach(async () => {
  if (stack) { await stack.shutdown(); stack = null }
  if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null }
})

describe('content-memory wired onto the stack', () => {
  it('exposes contentMemory and builds a pack for the default workspace', async () => {
    dir = mkdtempSync(join(tmpdir(), 'anubis-cm-'))
    const builtin = getBuiltinSkillRoots()
    stack = createConversationService({
      dataDir: dir,
      skillRoots: {
        autoInject: builtin.autoInject, optIn: builtin.optIn,
        user: join(dir, 'skills'), userAutoInject: join(dir, 'skills', 'auto-inject'),
        userOptIn: join(dir, 'skills', 'opt-in'),
      },
    })
    const { pack, packId } = await stack.contentMemory.buildForContentTask({
      workspaceId: 'default-workspace', platform: 'instagram',
      taskType: 'generate_content', query: 'test', objective: 'Generate',
    })
    expect(pack.workspaceId).toBe('default-workspace')
    expect(typeof packId).toBe('string')
  })

  it('exposes experience and records + promotes a memory', async () => {
    dir = mkdtempSync(join(tmpdir(), 'anubis-cm-'))
    const builtin = getBuiltinSkillRoots()
    stack = createConversationService({
      dataDir: dir,
      skillRoots: {
        autoInject: builtin.autoInject, optIn: builtin.optIn,
        user: join(dir, 'skills'), userAutoInject: join(dir, 'skills', 'auto-inject'),
        userOptIn: join(dir, 'skills', 'opt-in'),
      },
    })
    const m = stack.experience.recordCandidate({
      workspaceId: 'default-workspace', type: 'mistake',
      title: 't', problem: 'p', correction: 'c',
    })
    stack.experience.promote(m.id)
    const active = stack.experience.recallActive({
      workspaceId: 'default-workspace', platform: 'instagram',
    })
    expect(active.map((x) => x.id)).toContain(m.id)
  })
})
