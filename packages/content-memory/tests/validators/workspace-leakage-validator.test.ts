import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { freshDb } from '../helpers/db.js'
import { BrandWorkspacesRepo } from '../../src/db/repositories/brand-workspaces-repo.js'
import { WorkspaceLeakageValidator } from '../../src/validators/workspace-leakage-validator.js'
import type { ContentContextPack } from '../../src/context-pack/types.js'

const here = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(here, '../../src/db/migrations/008_brand_workspaces.sql'), 'utf8')

function pack(workspaceId: string): ContentContextPack {
  return {
    workspaceId, platform: 'instagram', taskType: 'generate_content', objective: 'o',
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
  const db = freshDb([{ version: 8, sql }])
  const brands = new BrandWorkspacesRepo(db)
  brands.insert({ id: 'ws-a', name: 'GlowSkin', brandSummary: null, toneOfVoice: [], audience: [],
    offers: [], constraints: [], status: 'active', createdAt: 1, updatedAt: 1 })
  brands.insert({ id: 'ws-b', name: 'IronFit', brandSummary: null, toneOfVoice: [], audience: [],
    offers: [], constraints: [], status: 'active', createdAt: 1, updatedAt: 1 })
  return new WorkspaceLeakageValidator(brands)
}

describe('WorkspaceLeakageValidator', () => {
  it('flags output that names another brand workspace', async () => {
    const v = setup()
    const r = await v.validate({
      workspaceId: 'ws-a', platform: 'instagram', contextPack: pack('ws-a'),
      output: 'Just like IronFit does, try this routine.',
    })
    expect(r.passed).toBe(false)
    expect(r.issues[0]!.type).toBe('workspace_leakage')
    expect(r.severity).toBe('critical')
  })

  it('passes clean output that names only the active brand', async () => {
    const v = setup()
    const r = await v.validate({
      workspaceId: 'ws-a', platform: 'instagram', contextPack: pack('ws-a'),
      output: 'GlowSkin gentle routine for the evening.',
    })
    expect(r.passed).toBe(true)
    expect(r.issues).toHaveLength(0)
  })
})
