import type { Db } from '../client.js'
import { nowMs } from '../../util/time.js'
import { BUILTIN_WORKFLOWS } from '../../workflows/builtin.js'

export interface WorkflowRow {
  id: string
  name: string
  description: string | null
  project_id: string | null
  draft_graph: string
  published_graph: string | null
  draft_updated_at: number
  published_at: number | null
  created_at: number
  updated_at: number
}

export interface Workflow {
  id: string
  name: string
  projectId?: string
  description?: string
  draftGraph: string
  publishedGraph?: string
  draftUpdatedAt: number
  publishedAt?: number
  createdAt: number
  updatedAt: number
}

function toWorkflow(r: WorkflowRow): Workflow {
  return {
    id: r.id,
    name: r.name,
    projectId: r.project_id ?? undefined,
    description: r.description ?? undefined,
    draftGraph: r.draft_graph,
    publishedGraph: r.published_graph ?? undefined,
    draftUpdatedAt: r.draft_updated_at,
    publishedAt: r.published_at ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

const EMPTY_GRAPH = JSON.stringify({ nodes: [], edges: [] })

export class WorkflowsRepo {
  constructor(private db: Db) {}

  create(input: { id: string; name: string; projectId?: string; description?: string; now: number }): Workflow {
    this.db
      .prepare(
        `INSERT INTO workflows (id, name, project_id, description, draft_graph, published_graph,
          draft_updated_at, published_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)`,
      )
      .run(
        input.id, input.name, input.projectId ?? 'default', input.description ?? null, EMPTY_GRAPH,
        input.now, input.now, input.now,
      )
    return this.getOrThrow(input.id)
  }

  /**
   * Create a workflow from an imported graph. Unlike `create` (which starts
   * from an empty graph), this seeds the draft with `draftGraph` and leaves the
   * workflow unpublished so the importer reviews before publishing.
   */
  importGraph(input: { id: string; name: string; projectId?: string; description?: string; draftGraph: string; now: number }): Workflow {
    this.db
      .prepare(
        `INSERT INTO workflows (id, name, project_id, description, draft_graph, published_graph,
          draft_updated_at, published_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)`,
      )
      .run(
        input.id, input.name, input.projectId ?? 'default', input.description ?? null, input.draftGraph,
        input.now, input.now, input.now,
      )
    return this.getOrThrow(input.id)
  }

  list(projectId?: string): Workflow[] {
    if (projectId) {
      const rows = this.db.prepare(`SELECT * FROM workflows WHERE project_id = ? ORDER BY updated_at DESC`).all(projectId) as WorkflowRow[]
      return rows.map(toWorkflow)
    }
    const rows = this.db.prepare(`SELECT * FROM workflows ORDER BY updated_at DESC`).all() as WorkflowRow[]
    return rows.map(toWorkflow)
  }

  get(id: string): Workflow | null {
    const row = this.db.prepare(`SELECT * FROM workflows WHERE id = ?`).get(id) as WorkflowRow | undefined
    return row ? toWorkflow(row) : null
  }

  getOrThrow(id: string): Workflow {
    const w = this.get(id)
    if (!w) throw new Error(`workflow ${id} not found`)
    return w
  }

  updateMeta(id: string, patch: { name?: string; description?: string | null }, now: number): Workflow {
    const current = this.getOrThrow(id)
    this.db
      .prepare(`UPDATE workflows SET name = ?, description = ?, updated_at = ? WHERE id = ?`)
      .run(
        patch.name ?? current.name,
        patch.description === undefined ? current.description ?? null : patch.description,
        now,
        id,
      )
    return this.getOrThrow(id)
  }

  writeDraft(id: string, draftGraph: string, now: number): Workflow {
    this.db
      .prepare(`UPDATE workflows SET draft_graph = ?, draft_updated_at = ?, updated_at = ? WHERE id = ?`)
      .run(draftGraph, now, now, id)
    return this.getOrThrow(id)
  }

  publish(id: string, now: number): Workflow {
    const current = this.getOrThrow(id)
    this.db
      .prepare(`UPDATE workflows SET published_graph = ?, published_at = ?, updated_at = ? WHERE id = ?`)
      .run(current.draftGraph, now, now, id)
    return this.getOrThrow(id)
  }

  delete(id: string): void {
    this.db.prepare(`DELETE FROM workflows WHERE id = ?`).run(id)
  }

  /**
   * Seed the built-in starter workflows. Idempotent and edit-safe: it only
   * inserts a workflow whose id is absent, so user edits survive across boots
   * and a deleted built-in re-appears on next launch — mirroring built-in
   * profiles. Each built-in ships pre-published so it's runnable once configured.
   */
  seedBuiltins(): void {
    const now = nowMs()
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO workflows (id, name, description, draft_graph, published_graph,
        draft_updated_at, published_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const w of BUILTIN_WORKFLOWS) {
      stmt.run(w.id, w.name, w.description, w.graph, w.graph, now, now, now, now)
    }
  }
}
