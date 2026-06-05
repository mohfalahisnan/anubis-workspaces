import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { freshDb } from '../helpers/db.js'
import { BrandWorkspacesRepo } from '../../src/db/repositories/brand-workspaces-repo.js'
import { ExperienceMemoriesRepo } from '../../src/db/repositories/experience-memories-repo.js'
import { ExperienceIndexService } from '../../src/experience/experience-index-service.js'
import { RepeatedMistakeValidator } from '../../src/validators/repeated-mistake-validator.js'
import type { ContentContextPack } from '../../src/context-pack/types.js'

const here = dirname(fileURLToPath(import.meta.url))
const sqlFor = (f: string) => readFileSync(join(here, '../../src/db/migrations', f), 'utf8')
const migrations = [
  { version: 8, sql: sqlFor('008_brand_workspaces.sql') },
  { version: 14, sql: sqlFor('014_experience_memories.sql') },
]

function emptyPack(): ContentContextPack {
  return {
    workspaceId: 'ws-a', platform: 'instagram', taskType: 'generate_content', objective: 'o',
    brandContext: { brandSummary: '', toneOfVoice: [], audience: [], offers: [], constraints: [] },
    platformContext: { platform: 'instagram', formatRules: [], contentPatterns: [], algorithmNotes: [] },
    similarContent: { approved: [], competitor: [], rejected: [] },
    globalFrameworks: { hooks: [], copywritingPatterns: [], contentStructures: [], ctaPatterns: [] },
    workspaceRules: { mustFollow: [], mustAvoid: [], clientPreferences: [] },
    experienceMemory: { previousMistakes: [], reviewerFeedback: [], validationRules: [] },
    citations: [], finalInstruction: '',
  }
}

function setup() {
  const db = freshDb(migrations)
  new BrandWorkspacesRepo(db).insert({ id: 'ws-a', name: 'A', brandSummary: null, toneOfVoice: [],
    audience: [], offers: [], constraints: [], status: 'active', createdAt: 1, updatedAt: 1 })
  const experience = new ExperienceIndexService(new ExperienceMemoriesRepo(db))
  return { experience, v: new RepeatedMistakeValidator(experience) }
}

describe('RepeatedMistakeValidator', () => {
  it('flags output that hits an active mistake trigger pattern', async () => {
    const { experience, v } = setup()
    const m = experience.recordCandidate({
      workspaceId: 'ws-a', type: 'mistake', title: 'Fear hook',
      problem: 'used a fear hook', correction: 'use a soft hook',
      triggerPattern: 'scary truth',
    })
    experience.promote(m.id)
    const r = await v.validate({
      workspaceId: 'ws-a', platform: 'instagram', contextPack: emptyPack(),
      output: "Here's the scary truth about your skin.",
    })
    expect(r.passed).toBe(false)
    expect(r.issues[0]!.type).toBe('repeated_mistake')
    expect(r.issues[0]!.relatedMemoryId).toBe(m.id)
    expect(r.issues[0]!.suggestedCorrection).toBe('use a soft hook')
  })

  it('passes when no trigger pattern matches', async () => {
    const { experience, v } = setup()
    const m = experience.recordCandidate({
      workspaceId: 'ws-a', type: 'mistake', title: 'Fear hook',
      problem: 'x', correction: 'y', triggerPattern: 'scary truth',
    })
    experience.promote(m.id)
    const r = await v.validate({
      workspaceId: 'ws-a', platform: 'instagram', contextPack: emptyPack(),
      output: 'A gentle, helpful tip.',
    })
    expect(r.passed).toBe(true)
  })
})
