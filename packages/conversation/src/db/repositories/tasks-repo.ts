import type { TaskPriority, TaskStatus } from '@anubis/shared'
import type { Db } from '../client.js'

export interface Task {
  id: string
  projectId?: string
  title: string
  description?: string
  status: TaskStatus
  priority: TaskPriority
  assigneeProfileId?: string
  fileReferences: string[]
  workflowReferences: string[]
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

interface Row {
  id: string
  project_id: string | null
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  assignee_profile_id: string | null
  file_references: string
  workflow_references: string
  created_at: number
  updated_at: number
  deleted_at: number | null
}

export interface ListTasksOpts {
  projectId?: string
  status?: TaskStatus
  assigneeProfileId?: string
  limit?: number
}

export interface CreateTaskInput {
  id: string
  projectId?: string
  title: string
  description?: string
  status?: TaskStatus
  priority?: TaskPriority
  assigneeProfileId?: string
  fileReferences?: string[]
  workflowReferences?: string[]
  now: number
}

export type UpdateTaskPatch = Partial<Omit<Task, 'id' | 'projectId' | 'createdAt' | 'deletedAt'>>

function parseStringArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

function toTask(row: Row): Task {
  return {
    id: row.id,
    projectId: row.project_id ?? undefined,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status,
    priority: row.priority,
    assigneeProfileId: row.assignee_profile_id ?? undefined,
    fileReferences: parseStringArray(row.file_references),
    workflowReferences: parseStringArray(row.workflow_references),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? undefined,
  }
}

export class TasksRepo {
  constructor(private db: Db) {}

  create(input: CreateTaskInput): Task {
    this.db
      .prepare(`
        INSERT INTO tasks (
          id, project_id, title, description, status, priority, assignee_profile_id,
          file_references, workflow_references, created_at, updated_at
        ) VALUES (
          @id, @projectId, @title, @description, @status, @priority, @assigneeProfileId,
          @fileReferences, @workflowReferences, @createdAt, @updatedAt
        )
      `)
      .run({
        id: input.id,
        projectId: input.projectId ?? 'default',
        title: input.title,
        description: input.description ?? null,
        status: input.status ?? 'backlog',
        priority: input.priority ?? 'medium',
        assigneeProfileId: input.assigneeProfileId ?? null,
        fileReferences: JSON.stringify(input.fileReferences ?? []),
        workflowReferences: JSON.stringify(input.workflowReferences ?? []),
        createdAt: input.now,
        updatedAt: input.now,
      })
    return this.findByIdOrThrow(input.id)
  }

  findById(id: string): Task | null {
    const row = this.db
      .prepare('SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL')
      .get(id) as Row | undefined
    return row ? toTask(row) : null
  }

  findByIdOrThrow(id: string): Task {
    const task = this.findById(id)
    if (!task) throw new Error(`task ${id} not found`)
    return task
  }

  list(opts: ListTasksOpts = {}): Task[] {
    const where = ['deleted_at IS NULL']
    const params: unknown[] = []
    if (opts.projectId) { where.push('project_id = ?'); params.push(opts.projectId) }
    if (opts.status) { where.push('status = ?'); params.push(opts.status) }
    if (opts.assigneeProfileId) { where.push('assignee_profile_id = ?'); params.push(opts.assigneeProfileId) }
    params.push(opts.limit ?? 200)
    const rows = this.db
      .prepare(`SELECT * FROM tasks WHERE ${where.join(' AND ')} ORDER BY updated_at DESC LIMIT ?`)
      .all(...params) as Row[]
    return rows.map(toTask)
  }

  update(id: string, patch: UpdateTaskPatch): Task | null {
    const current = this.findById(id)
    if (!current) return null
    const next: Task = { ...current, ...patch, updatedAt: Date.now() }
    this.db
      .prepare(`
        UPDATE tasks SET
          title = ?,
          description = ?,
          status = ?,
          priority = ?,
          assignee_profile_id = ?,
          file_references = ?,
          workflow_references = ?,
          updated_at = ?
        WHERE id = ? AND deleted_at IS NULL
      `)
      .run(
        next.title,
        next.description ?? null,
        next.status,
        next.priority,
        next.assigneeProfileId ?? null,
        JSON.stringify(next.fileReferences),
        JSON.stringify(next.workflowReferences),
        next.updatedAt,
        id,
      )
    return next
  }

  softDelete(id: string): Task | null {
    const current = this.findById(id)
    if (!current) return null
    const now = Date.now()
    this.db
      .prepare('UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ?')
      .run(now, now, id)
    return current
  }
}
