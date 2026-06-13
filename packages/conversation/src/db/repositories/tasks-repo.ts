import type { TaskPriority, TaskStatus } from '@anubis/shared'
import { z } from 'zod'
import { DocumentStoreError, parseDocumentData, type MarkdownDocument, type MarkdownDocumentStore } from '../../documents/document-store.js'

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

const TaskData = z.object({
  id: z.string(),
  project_id: z.string(),
  title: z.string().min(1),
  status: z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'done']),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  assignee_profile_id: z.string().optional().nullable(),
  file_references: z.array(z.string()).default([]),
  workflow_references: z.array(z.string()).default([]),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
}).passthrough()

const STATUS_DIR: Record<TaskStatus, string> = {
  backlog: 'backlog',
  todo: 'todo',
  in_progress: 'in-progress',
  in_review: 'in-review',
  done: 'done',
}

const ROOT = 'tasks'

export class TasksRepo {
  constructor(private readonly documents: MarkdownDocumentStore) {}

  create(input: CreateTaskInput): Task {
    const task: Task = {
      id: input.id,
      projectId: input.projectId ?? 'default',
      title: input.title,
      description: input.description,
      status: input.status ?? 'backlog',
      priority: input.priority ?? 'medium',
      assigneeProfileId: input.assigneeProfileId,
      fileReferences: input.fileReferences ?? [],
      workflowReferences: input.workflowReferences ?? [],
      createdAt: input.now,
      updatedAt: input.now,
    }
    this.write(task, null, input.now)
    return this.findByIdOrThrow(input.id)
  }

  findById(id: string): Task | null {
    const document = this.documents.find('task', ROOT, id)
    return document ? toTask(document) : null
  }

  findByIdOrThrow(id: string): Task {
    const task = this.findById(id)
    if (!task) throw new Error(`task ${id} not found`)
    return task
  }

  list(opts: ListTasksOpts = {}): Task[] {
    let tasks = this.documents.list('task', ROOT, opts.projectId).map(toTask)
    if (opts.status) tasks = tasks.filter((task) => task.status === opts.status)
    if (opts.assigneeProfileId) tasks = tasks.filter((task) => task.assigneeProfileId === opts.assigneeProfileId)
    return tasks.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, opts.limit ?? 200)
  }

  update(id: string, patch: UpdateTaskPatch): Task | null {
    const document = this.documents.find('task', ROOT, id)
    if (!document) return null
    const current = toTask(document)
    const next: Task = { ...current, ...patch, updatedAt: Date.now() }
    this.write(next, document, next.updatedAt)
    return this.findById(id)
  }

  softDelete(id: string): Task | null {
    const current = this.findById(id)
    if (!current) return null
    this.documents.delete('task', ROOT, id)
    return current
  }

  private write(task: Task, existing: MarkdownDocument | null, now: number): void {
    this.documents.write({
      type: 'task',
      projectId: task.projectId ?? 'default',
      root: ROOT,
      directory: STATUS_DIR[task.status],
      id: task.id,
      title: task.title,
      existing,
      now,
      data: {
        title: task.title,
        status: task.status,
        priority: task.priority,
        assignee_profile_id: task.assigneeProfileId ?? null,
        file_references: task.fileReferences,
        workflow_references: task.workflowReferences,
      },
      body: task.description ?? '',
    })
  }
}

function toTask(document: MarkdownDocument): Task {
  const data = parseDocumentData(document, TaskData, 'task')
  const expectedDir = STATUS_DIR[data.status]
  const parts = document.relativePath.split('/')
  if (parts[0] !== ROOT || parts[1] !== expectedDir) {
    throw new DocumentStoreError(
      'INVALID_DOCUMENT',
      `Task ${data.id} status ${data.status} must be stored under tasks/${expectedDir}`,
      { path: document.relativePath },
    )
  }
  return {
    id: data.id,
    projectId: data.project_id,
    title: data.title,
    description: document.body.trim() || undefined,
    status: data.status,
    priority: data.priority,
    assigneeProfileId: data.assignee_profile_id ?? undefined,
    fileReferences: data.file_references,
    workflowReferences: data.workflow_references,
    createdAt: Date.parse(data.created_at),
    updatedAt: Date.parse(data.updated_at),
  }
}
