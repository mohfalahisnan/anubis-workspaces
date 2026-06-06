import { Hono } from 'hono'
import { z } from 'zod'
import { DEFAULT_WORKSPACE_ID } from '@anubis/conversation'
import type { BrandWorkspaceSummary } from '@anubis/shared'
import { getStack } from './services.js'

const CreateBody = z.object({
  name: z.string().min(1),
  brandSummary: z.string().optional(),
}).strict()

const UpdateBody = z.object({
  name: z.string().min(1).optional(),
  brandSummary: z.string().nullable().optional(),
  status: z.enum(['active', 'archived']).optional(),
}).strict()

function toSummary(w: {
  id: string; name: string; brandSummary: string | null
  status: 'active' | 'archived'; createdAt: number; updatedAt: number
}): BrandWorkspaceSummary {
  return {
    id: w.id, name: w.name, brandSummary: w.brandSummary,
    status: w.status, createdAt: w.createdAt, updatedAt: w.updatedAt,
  }
}

export const brandWorkspaceRoutes = new Hono()

brandWorkspaceRoutes.get('/', (c) => {
  const items = getStack().brandWorkspaces.list()
    .filter((w) => w.status === 'active')
    .map(toSummary)
  return c.json({ ok: true, items })
})

brandWorkspaceRoutes.post('/', async (c) => {
  const body = CreateBody.parse(await c.req.json())
  const workspace = getStack().brandWorkspaces.create(body)
  return c.json({ ok: true, workspace: toSummary(workspace) }, 201)
})

brandWorkspaceRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id')
  const body = UpdateBody.parse(await c.req.json())
  if (id === DEFAULT_WORKSPACE_ID && body.status === 'archived') {
    return c.json({ ok: false, error: 'cannot_archive_default' }, 400)
  }
  const workspace = getStack().brandWorkspaces.update(id, body)
  if (!workspace) return c.json({ ok: false, error: 'not_found' }, 404)
  return c.json({ ok: true, workspace: toSummary(workspace) })
})
