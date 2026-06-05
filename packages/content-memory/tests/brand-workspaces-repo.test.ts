import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { freshDb } from './helpers/db.js'
import { BrandWorkspacesRepo } from '../src/db/repositories/brand-workspaces-repo.js'
import { DEFAULT_WORKSPACE_ID } from '../src/types.js'

const here = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(
  join(here, '../src/db/migrations/008_brand_workspaces.sql'),
  'utf8',
)
const migrations = [{ version: 8, sql }]

describe('BrandWorkspacesRepo', () => {
  it('seeds a default workspace via the migration', () => {
    const repo = new BrandWorkspacesRepo(freshDb(migrations))
    const def = repo.findById(DEFAULT_WORKSPACE_ID)
    expect(def?.name).toBe('Default Workspace')
  })

  it('inserts and reads a brand with array fields round-tripped', () => {
    const repo = new BrandWorkspacesRepo(freshDb(migrations))
    repo.insert({
      id: 'ws-a',
      name: 'Skincare A',
      brandSummary: 'Gentle skincare',
      toneOfVoice: ['warm', 'educational'],
      audience: ['women 25-40'],
      offers: ['serum'],
      constraints: ['no fear-based hooks'],
      status: 'active',
      createdAt: 100,
      updatedAt: 100,
    })
    const got = repo.findById('ws-a')
    expect(got?.toneOfVoice).toEqual(['warm', 'educational'])
    expect(got?.constraints).toEqual(['no fear-based hooks'])
  })

  it('lists active workspaces', () => {
    const repo = new BrandWorkspacesRepo(freshDb(migrations))
    repo.insert({
      id: 'ws-a', name: 'A', brandSummary: null,
      toneOfVoice: [], audience: [], offers: [], constraints: [],
      status: 'active', createdAt: 100, updatedAt: 100,
    })
    const ids = repo.list().map((w) => w.id)
    expect(ids).toContain('ws-a')
    expect(ids).toContain(DEFAULT_WORKSPACE_ID)
  })
})
