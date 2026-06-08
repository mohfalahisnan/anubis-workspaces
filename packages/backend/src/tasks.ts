import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import type { Task, UpdateTaskPatch } from '@anubis/conversation'
import type { TaskSummary } from '@anubis/shared'
import { getStack } from './services.js'

const StatusSchema = z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'done'])
const PrioritySchema = z.enum(['low', 'medium', 'high', 'urgent'])

const ReferenceArray = z.array(z.string().min(1)).max(100)

const ListQuery = z.object({
  projectId: z.string().optional(),
  status: StatusSchema.optional(),
  assigneeProfileId: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
}).strict()

const CreateBody = z.object({
  projectId: z.string().min(1).optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  status: StatusSchema.optional(),
  priority: PrioritySchema.optional(),
  assigneeProfileId: z.string().min(1).optional(),
  fileReferences: ReferenceArray.optional(),
  workflowReferences: ReferenceArray.optional(),
}).strict()

const UpdateBody = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  status: StatusSchema.optional(),
  priority: PrioritySchema.optional(),
  assigneeProfileId: z.string().min(1).nullable().optional(),
  fileReferences: ReferenceArray.optional(),
  workflowReferences: ReferenceArray.optional(),
}).strict()

export const taskRoutes = new Hono()

taskRoutes.get('/', (c) => {
  const parsed = ListQuery.safeParse(Object.fromEntries(new URL(c.req.url).searchParams))
  if (!parsed.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST', issues: parsed.error.issues } }, 400)
  const items = getStack().tasks
    .list({
      projectId: parsed.data.projectId,
      status: parsed.data.status,
      assigneeProfileId: parsed.data.assigneeProfileId,
      limit: parsed.data.limit ?? 200,
    })
    .map(toSummary)
  return c.json({ ok: true, items })
})

taskRoutes.get('/:id', (c) => {
  const task = getStack().tasks.findById(c.req.param('id'))
  if (!task) return c.json({ ok: false, error: 'not_found' }, 404)
  return c.json({ ok: true, task: toSummary(task) })
})

taskRoutes.post('/', async (c) => {
  const stack = getStack()
  const body = CreateBody.parse(await c.req.json())
  const projectId = body.projectId ?? 'default'
  const validation = validateReferences(projectId, body.assigneeProfileId, body.workflowReferences ?? [])
  if (validation) return c.json(validation.body, validation.status)

  const task = stack.tasks.create({
    id: randomUUID(),
    projectId,
    title: body.title.trim(),
    description: normalizeOptional(body.description),
    status: body.status,
    priority: body.priority,
    assigneeProfileId: body.assigneeProfileId,
    fileReferences: normalizeReferences(body.fileReferences),
    workflowReferences: normalizeReferences(body.workflowReferences),
    now: Date.now(),
  })
  return c.json({ ok: true, task: toSummary(task) }, 201)
})

taskRoutes.patch('/:id', async (c) => {
  const stack = getStack()
  const current = stack.tasks.findById(c.req.param('id'))
  if (!current) return c.json({ ok: false, error: 'not_found' }, 404)

  const body = UpdateBody.parse(await c.req.json())
  const nextAssignee = 'assigneeProfileId' in body ? body.assigneeProfileId ?? undefined : current.assigneeProfileId
  const nextWorkflowReferences = 'workflowReferences' in body
    ? normalizeReferences(body.workflowReferences)
    : current.workflowReferences
  const validation = validateReferences(current.projectId ?? 'default', nextAssignee, nextWorkflowReferences)
  if (validation) return c.json(validation.body, validation.status)

  const patch: UpdateTaskPatch = {}
  if ('title' in body) patch.title = body.title?.trim()
  if ('description' in body) patch.description = normalizeNullable(body.description)
  if ('status' in body) patch.status = body.status
  if ('priority' in body) patch.priority = body.priority
  if ('assigneeProfileId' in body) patch.assigneeProfileId = body.assigneeProfileId ?? undefined
  if ('fileReferences' in body) patch.fileReferences = normalizeReferences(body.fileReferences)
  if ('workflowReferences' in body) patch.workflowReferences = nextWorkflowReferences

  const task = stack.tasks.update(current.id, patch)
  if (!task) return c.json({ ok: false, error: 'not_found' }, 404)
  return c.json({ ok: true, task: toSummary(task) })
})

taskRoutes.delete('/:id', (c) => {
  const task = getStack().tasks.softDelete(c.req.param('id'))
  if (!task) return c.json({ ok: false, error: 'not_found' }, 404)
  return c.json({ ok: true })
})

function validateReferences(
  projectId: string,
  assigneeProfileId: string | undefined,
  workflowReferences: string[],
): { status: 400 | 404; body: { ok: false; error: string } } | null {
  const stack = getStack()
  if (!stack.projects.findById(projectId)) {
    return { status: 404, body: { ok: false, error: 'project_not_found' } }
  }
  if (assigneeProfileId && !stack.profiles.get(assigneeProfileId)) {
    return { status: 404, body: { ok: false, error: 'assignee_profile_not_found' } }
  }
  for (const workflowId of workflowReferences) {
    const workflow = stack.workflows.get(workflowId)
    if (!workflow) return { status: 404, body: { ok: false, error: 'workflow_not_found' } }
    if ((workflow.projectId ?? 'default') !== projectId) {
      return { status: 400, body: { ok: false, error: 'workflow_project_mismatch' } }
    }
  }
  return null
}

function normalizeOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function normalizeNullable(value: string | null | undefined): string | undefined {
  if (value == null) return undefined
  return normalizeOptional(value)
}

function normalizeReferences(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)))
}

function toSummary(task: Task): TaskSummary {
  return {
    id: task.id,
    projectId: task.projectId,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    assigneeProfileId: task.assigneeProfileId,
    fileReferences: task.fileReferences,
    workflowReferences: task.workflowReferences,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  }
}
