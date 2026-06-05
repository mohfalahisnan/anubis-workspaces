import type { Db } from '../client.js'

export interface WorkflowTriggerState {
  workflowId: string
  armed: boolean
  armedAt?: number
}

interface TriggerRow {
  workflow_id: string
  armed: number
  armed_at: number | null
}

export class WorkflowTriggersRepo {
  constructor(private db: Db) {}

  setArmed(workflowId: string, armed: boolean, armedAt: number | null): void {
    this.db
      .prepare(
        `INSERT INTO workflow_triggers (workflow_id, armed, armed_at)
         VALUES (?, ?, ?)
         ON CONFLICT(workflow_id) DO UPDATE SET
           armed = excluded.armed,
           armed_at = excluded.armed_at`,
      )
      .run(workflowId, armed ? 1 : 0, armedAt ?? null)
  }

  getArmed(workflowId: string): boolean {
    const row = this.db
      .prepare(`SELECT armed FROM workflow_triggers WHERE workflow_id = ?`)
      .get(workflowId) as { armed: number } | undefined
    return row?.armed === 1
  }

  listArmed(): WorkflowTriggerState[] {
    const rows = this.db
      .prepare(`SELECT * FROM workflow_triggers WHERE armed = 1`)
      .all() as TriggerRow[]
    return rows.map((r) => ({
      workflowId: r.workflow_id,
      armed: r.armed === 1,
      armedAt: r.armed_at ?? undefined,
    }))
  }
}
