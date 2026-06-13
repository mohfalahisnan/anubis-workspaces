import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'anubis-tasks-'))
  process.env.ANUBIS_DATA_DIR = tmpDir
})

afterAll(async () => {
  try {
    const services = await import('../src/services.js')
    await services.shutdownStack()
  } catch { /* best-effort */ }
  await rm(tmpDir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {})
  delete process.env.ANUBIS_DATA_DIR
})

async function loadApp() {
  const mod = await import('../src/app.js')
  return mod.default
}

describe('task routes', () => {
  it('creates, lists, updates, and deletes project-scoped tasks', async () => {
    const app = await loadApp()

    const workflowRes = await app.request('/workflows', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'default', name: 'Reference workflow' }),
    })
    expect(workflowRes.status).toBe(201)
    const workflowBody = await workflowRes.json() as { id: string }

    const created = await app.request('/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: 'default',
        title: 'Build task board',
        description: 'Generic task management',
        priority: 'high',
        assigneeProfileId: 'codex-coding',
        fileReferences: ['packages/frontend/src/pages/tasks.tsx'],
        workflowReferences: [workflowBody.id],
      }),
    })
    expect(created.status).toBe(201)
    const createdBody = await created.json() as {
      task: {
        id: string
        status: string
        priority: string
        assigneeProfileId?: string
        fileReferences: string[]
        workflowReferences: string[]
      }
    }
    expect(createdBody.task.status).toBe('backlog')
    expect(createdBody.task.priority).toBe('high')
    expect(createdBody.task.assigneeProfileId).toBe('codex-coding')
    expect(createdBody.task.fileReferences).toEqual(['packages/frontend/src/pages/tasks.tsx'])
    expect(createdBody.task.workflowReferences).toEqual([workflowBody.id])

    const patched = await app.request(`/tasks/${createdBody.task.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        status: 'in_progress',
        priority: 'urgent',
        assigneeProfileId: null,
        fileReferences: ['C:/Projects/anubis-workspaces/CONTEXT.md'],
      }),
    })
    expect(patched.status).toBe(200)
    const patchedBody = await patched.json() as {
      task: { status: string; priority: string; assigneeProfileId?: string; fileReferences: string[] }
    }
    expect(patchedBody.task.status).toBe('in_progress')
    expect(patchedBody.task.priority).toBe('urgent')
    expect(patchedBody.task.assigneeProfileId).toBeUndefined()
    expect(patchedBody.task.fileReferences).toEqual(['C:/Projects/anubis-workspaces/CONTEXT.md'])

    const inProgressDir = join(tmpDir, 'workspaces', 'default', 'tasks', 'in-progress')
    const files = await readdir(inProgressDir)
    expect(files).toHaveLength(1)
    const taskPath = join(inProgressDir, files[0]!)
    const manuallyRenamed = join(inProgressDir, 'edited-outside-anubis.md')
    await rename(taskPath, manuallyRenamed)
    const source = await readFile(manuallyRenamed, 'utf8')
    await writeFile(manuallyRenamed, source.replace('Generic task management', 'Edited manually'), 'utf8')

    const manuallyEdited = await app.request(`/tasks/${createdBody.task.id}`).then((r) => r.json()) as {
      task: { description?: string }
    }
    expect(manuallyEdited.task.description).toBe('Edited manually')

    const listed = await app.request('/tasks?projectId=default').then((r) => r.json()) as { items: unknown[] }
    expect(listed.items).toHaveLength(1)

    const deleted = await app.request(`/tasks/${createdBody.task.id}`, { method: 'DELETE' })
    expect(deleted.status).toBe(200)
    const listedAfter = await app.request('/tasks?projectId=default').then((r) => r.json()) as { items: unknown[] }
    expect(listedAfter.items).toHaveLength(0)
  })

  it('rejects workflow references outside the task project', async () => {
    const app = await loadApp()
    const project = await app.request('/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Other Project' }),
    }).then((r) => r.json()) as { project: { id: string } }

    const workflow = await app.request('/workflows', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.project.id, name: 'Other workflow' }),
    }).then((r) => r.json()) as { id: string }

    const created = await app.request('/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: 'default',
        title: 'Mismatched workflow',
        workflowReferences: [workflow.id],
      }),
    })
    expect(created.status).toBe(400)
  })
})
