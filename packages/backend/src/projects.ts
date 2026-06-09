import { Hono } from 'hono'
import { z } from 'zod'
import { getStack } from './services.js'
import { newId, ensureWorkspaceStructure } from '@anubis/conversation'
import { deleteKnowledgeBaseForWorkdir } from './knowledge-base.js'

const CreateBody = z.object({
  name: z.string().min(1),
  emoji: z.string().min(1).optional(),
  color: z.string().min(1).optional(),
  description: z.string().optional(),
  workdir: z.string().optional(),
}).strict()

const UpdateBody = z.object({
  name: z.string().min(1).optional(),
  emoji: z.string().min(1).optional(),
  color: z.string().min(1).optional(),
  description: z.string().optional(),
  workdir: z.string().optional(),
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
  if (body.workdir) {
    ensureWorkspaceStructure(body.workdir)
  }
  const id = newId()
  const now = Date.now()
  const project = {
    id,
    ...body,
    createdAt: now,
    updatedAt: now,
  }
  getStack().projects.insert(project)
  return c.json({ ok: true, project }, 201)
})

projectRoutes.patch('/:id', async (c) => {
  const body = UpdateBody.parse(await c.req.json())
  if (body.workdir) {
    ensureWorkspaceStructure(body.workdir)
  }
  const project = getStack().projects.update(c.req.param('id'), body)
  if (!project) return c.json({ ok: false, error: 'not_found' }, 404)
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
