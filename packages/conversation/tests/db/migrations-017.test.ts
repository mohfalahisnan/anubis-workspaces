import { describe, it, expect } from 'vitest'
import { openDatabase } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'

describe('migration 017 — workflow run pause statuses', () => {
  it('allows awaiting_approval / rejected run status, awaiting step status, and iteration', () => {
    const db = openDatabase(':memory:')
    runMigrations(db, MIGRATIONS)
    db.prepare(
      `INSERT INTO workflows (id,name,draft_graph,draft_updated_at,created_at,updated_at)
       VALUES ('w','n','{}',0,0,0)`,
    ).run()
    expect(() => db.prepare(
      `INSERT INTO workflow_runs (id,workflow_id,status,graph_snapshot,started_at)
       VALUES ('r','w','awaiting_approval','{}',0)`,
    ).run()).not.toThrow()
    expect(() => db.prepare(`UPDATE workflow_runs SET status='rejected' WHERE id='r'`).run()).not.toThrow()
    expect(() => db.prepare(
      `INSERT INTO workflow_run_steps (id,run_id,node_id,status,iteration)
       VALUES ('s','r','gate','awaiting',2)`,
    ).run()).not.toThrow()
    const step = db.prepare(`SELECT iteration FROM workflow_run_steps WHERE id='s'`).get() as { iteration: number }
    expect(step.iteration).toBe(2)
    db.close()
  })
})
