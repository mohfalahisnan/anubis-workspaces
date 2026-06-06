import type { Db } from '../types.js'
import type { BrandWorkspaceStatus } from '../../types.js'

export interface BrandWorkspace {
  id: string
  name: string
  brandSummary: string | null
  toneOfVoice: string[]
  audience: string[]
  offers: string[]
  constraints: string[]
  status: BrandWorkspaceStatus
  createdAt: number
  updatedAt: number
}

interface Row {
  id: string
  name: string
  brand_summary: string | null
  tone_of_voice: string
  audience: string
  offers: string
  constraints: string
  status: string
  created_at: number
  updated_at: number
}

function parseArr(s: string): string[] {
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? (v as string[]) : []
  } catch {
    return []
  }
}

function toWorkspace(r: Row): BrandWorkspace {
  return {
    id: r.id,
    name: r.name,
    brandSummary: r.brand_summary,
    toneOfVoice: parseArr(r.tone_of_voice),
    audience: parseArr(r.audience),
    offers: parseArr(r.offers),
    constraints: parseArr(r.constraints),
    status: r.status as BrandWorkspaceStatus,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export class BrandWorkspacesRepo {
  constructor(private db: Db) {}

  insert(w: BrandWorkspace): void {
    this.db.prepare(`
      INSERT INTO brand_workspaces (
        id, name, brand_summary, tone_of_voice, audience, offers, constraints,
        status, created_at, updated_at
      ) VALUES (
        @id, @name, @brandSummary, @toneOfVoice, @audience, @offers, @constraints,
        @status, @createdAt, @updatedAt
      )
    `).run({
      id: w.id,
      name: w.name,
      brandSummary: w.brandSummary ?? null,
      toneOfVoice: JSON.stringify(w.toneOfVoice),
      audience: JSON.stringify(w.audience),
      offers: JSON.stringify(w.offers),
      constraints: JSON.stringify(w.constraints),
      status: w.status,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
    })
  }

  findById(id: string): BrandWorkspace | null {
    const r = this.db
      .prepare('SELECT * FROM brand_workspaces WHERE id = ?')
      .get(id) as Row | undefined
    return r ? toWorkspace(r) : null
  }

  list(): BrandWorkspace[] {
    const rows = this.db
      .prepare("SELECT * FROM brand_workspaces WHERE status = 'active' ORDER BY created_at DESC, name ASC")
      .all() as Row[]
    return rows.map(toWorkspace)
  }

  update(
    id: string,
    patch: Partial<Pick<BrandWorkspace, 'name' | 'brandSummary' | 'status'>>,
    now: number,
  ): BrandWorkspace | null {
    const cur = this.findById(id)
    if (!cur) return null
    const next: BrandWorkspace = { ...cur, ...patch, updatedAt: now }
    this.db
      .prepare(
        `UPDATE brand_workspaces
         SET name = ?, brand_summary = ?, status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(next.name, next.brandSummary, next.status, next.updatedAt, id)
    return next
  }
}
