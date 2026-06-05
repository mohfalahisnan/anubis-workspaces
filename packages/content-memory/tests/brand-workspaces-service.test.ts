import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { freshDb } from './helpers/db.js'
import { BrandWorkspacesRepo } from '../src/db/repositories/brand-workspaces-repo.js'
import { BrandWorkspacesService } from '../src/workspaces/brand-workspaces-service.js'

const here = dirname(fileURLToPath(import.meta.url))
const migrations = [{
  version: 8,
  sql: readFileSync(join(here, '../src/db/migrations/008_brand_workspaces.sql'), 'utf8'),
}]

function service() {
  return new BrandWorkspacesService(new BrandWorkspacesRepo(freshDb(migrations)))
}

describe('BrandWorkspacesService', () => {
  it('creates a workspace with a generated id and defaults', () => {
    const svc = service()
    const ws = svc.create({ name: 'Skincare A' })
    expect(ws.id).toMatch(/[0-9a-f-]{36}/)
    expect(ws.name).toBe('Skincare A')
    expect(ws.toneOfVoice).toEqual([])
    expect(ws.status).toBe('active')
    expect(svc.get(ws.id)?.name).toBe('Skincare A')
  })

  it('persists provided brand fields', () => {
    const svc = service()
    const ws = svc.create({
      name: 'B', brandSummary: 'gentle', toneOfVoice: ['warm'],
      constraints: ['no fear hooks'],
    })
    expect(svc.get(ws.id)?.constraints).toEqual(['no fear hooks'])
  })
})
