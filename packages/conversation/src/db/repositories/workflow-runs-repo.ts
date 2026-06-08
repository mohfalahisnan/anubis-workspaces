import type { Db } from '../client.js'

export type RunStatus = 'pending' | 'running' | 'awaiting_approval' | 'succeeded' | 'failed' | 'rejected' | 'cancelled'
export type StepStatus = 'pending' | 'running' | 'awaiting' | 'succeeded' | 'failed' | 'skipped'

export interface WorkflowRun {
  id: string
  workflowId: string
  projectId?: string
  status: RunStatus
  graphSnapshot: string
  startedAt: number
  finishedAt?: number
  error?: string
}

export interface WorkflowRunStep {
  id: string
  runId: string
  nodeId: string
  status: StepStatus
  startedAt?: number
  finishedAt?: number
  output?: string
  error?: string
}

interface RunRow {
  id: string; workflow_id: string; project_id: string | null; status: RunStatus; graph_snapshot: string
  started_at: number; finished_at: number | null; error: string | null
}

interface StepRow {
  id: string; run_id: string; node_id: string; status: StepStatus
  started_at: number | null; finished_at: number | null
  output: string | null; error: string | null
}

function toRun(r: RunRow): WorkflowRun {
  return {
    id: r.id, workflowId: r.workflow_id, projectId: r.project_id ?? undefined,
    status: r.status, graphSnapshot: r.graph_snapshot,
    startedAt: r.started_at,
    finishedAt: r.finished_at ?? undefined,
    error: r.error ?? undefined,
  }
}

function toStep(r: StepRow): WorkflowRunStep {
  return {
    id: r.id, runId: r.run_id, nodeId: r.node_id, status: r.status,
    startedAt: r.started_at ?? undefined,
    finishedAt: r.finished_at ?? undefined,
    output: r.output ?? undefined,
    error: r.error ?? undefined,
  }
}

export class WorkflowRunsRepo {
  constructor(private db: Db) {}

  createRun(input: { id: string; workflowId: string; graphSnapshot: string; now: number }): WorkflowRun {
    this.db
      .prepare(
        `INSERT INTO workflow_runs (id, workflow_id, status, graph_snapshot, started_at, finished_at, error)
         VALUES (?, ?, 'running', ?, ?, NULL, NULL)`,
      )
      .run(input.id, input.workflowId, input.graphSnapshot, input.now)
    return this.getRunOrThrow(input.id)
  }

  getRun(id: string): WorkflowRun | null {
    const row = this.db.prepare(`SELECT * FROM workflow_runs WHERE id = ?`).get(id) as RunRow | undefined
    return row ? toRun(row) : null
  }

  getRunOrThrow(id: string): WorkflowRun {
    const r = this.getRun(id)
    if (!r) throw new Error(`run ${id} not found`)
    return r
  }

  listRunsForWorkflow(workflowId: string, limit = 50): WorkflowRun[] {
    const rows = this.db
      .prepare(`SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT ?`)
      .all(workflowId, limit) as RunRow[]
    return rows.map(toRun)
  }

  setRunStatus(id: string, status: RunStatus, finishedAt: number | null, error: string | null): void {
    this.db
      .prepare(`UPDATE workflow_runs SET status = ?, finished_at = ?, error = ? WHERE id = ?`)
      .run(status, finishedAt, error, id)
  }

  deleteRun(id: string): void {
    this.db.prepare(`DELETE FROM workflow_runs WHERE id = ?`).run(id)
  }

  upsertStep(step: {
    id: string; runId: string; nodeId: string; status: StepStatus
    startedAt?: number; finishedAt?: number; output?: string; error?: string
  }): WorkflowRunStep {
    this.db
      .prepare(
        `INSERT INTO workflow_run_steps (id, run_id, node_id, status, started_at, finished_at, output, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           started_at = excluded.started_at,
           finished_at = excluded.finished_at,
           output = excluded.output,
           error = excluded.error`,
      )
      .run(
        step.id, step.runId, step.nodeId, step.status,
        step.startedAt ?? null, step.finishedAt ?? null,
        step.output ?? null, step.error ?? null,
      )
    return this.getStepOrThrow(step.id)
  }

  listSteps(runId: string): WorkflowRunStep[] {
    const rows = this.db
      .prepare(`SELECT * FROM workflow_run_steps WHERE run_id = ? ORDER BY started_at ASC`)
      .all(runId) as StepRow[]
    return rows.map(toStep)
  }

  getStepOrThrow(id: string): WorkflowRunStep {
    const row = this.db.prepare(`SELECT * FROM workflow_run_steps WHERE id = ?`).get(id) as StepRow | undefined
    if (!row) throw new Error(`step ${id} not found`)
    return toStep(row)
  }
}
