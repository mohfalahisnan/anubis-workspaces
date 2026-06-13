import { Hono } from 'hono'
import { z } from 'zod'
import { getStack } from './services.js'
import { newId } from '@anubis/conversation'
import { deleteKnowledgeBaseForWorkdir } from './knowledge-base.js'

const CreateBody = z.object({
  name: z.string().min(1),
  emoji: z.string().min(1).optional(),
  color: z.string().min(1).optional(),
  description: z.string().optional(),
  workdir: z.string().trim().min(1).optional(),
}).strict()

const UpdateBody = z.object({
  name: z.string().min(1).optional(),
  emoji: z.string().min(1).optional(),
  color: z.string().min(1).optional(),
  description: z.string().optional(),
  workdir: z.string().trim().min(1).optional(),
}).strict()

export const projectRoutes = new Hono()

projectRoutes.get('/', (c) => {
  return c.json({ ok: true, items: getStack().projects.list() })
})

projectRoutes.get('/:id', (c) => {
  const project = getStack().projects.findById(c.req.param('id'))
  if (!project) return c.json({ ok: false, error: 'not_found' }, 404)
  return c.json({ ok: true, project })
})

projectRoutes.post('/', async (c) => {
  const body = CreateBody.parse(await c.req.json())
  const stack = getStack()
  const id = newId()
  const now = Date.now()
  const workdir = stack.projectWorkspaces.prepare(id, body.workdir)
  const project = {
    id,
    ...body,
    workdir,
    createdAt: now,
    updatedAt: now,
  }
  stack.projects.insert(project)
  return c.json({ ok: true, project }, 201)
})

projectRoutes.patch('/:id', async (c) => {
  const body = UpdateBody.parse(await c.req.json())
  const stack = getStack()
  const id = c.req.param('id')
  const current = stack.projects.findById(id)
  if (!current) return c.json({ ok: false, error: 'not_found' }, 404)
  const workdir = stack.projectWorkspaces.prepare(id, body.workdir ?? current.workdir)
  const project = stack.projects.update(id, { ...body, workdir })!
  return c.json({ ok: true, project })
})

projectRoutes.delete('/:id', (c) => {
  const id = c.req.param('id')
  if (id === 'default') {
    return c.json({ ok: false, error: 'Cannot delete default project' }, 403)
  }
  try {
    const project = getStack().projects.findById(id)
    getStack().projects.softDelete(id)
    try {
      deleteKnowledgeBaseForWorkdir(project?.workdir)
    } catch (cleanupErr) {
      console.warn('[projects] knowledge-base cleanup failed:', cleanupErr)
    }
    return c.json({ ok: true })
  } catch (e) {
    return c.json({ ok: false, error: (e as Error).message }, 400)
  }
})
