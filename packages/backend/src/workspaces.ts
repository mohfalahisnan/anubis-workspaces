import { Hono } from 'hono'
import { z } from 'zod'
import type { WorkspaceSummary } from '@anubis/shared'
import { getStack } from './services.js'

const RemoveBody = z.object({ path: z.string().min(1) }).strict()

export const workspaceRoutes = new Hono()

workspaceRoutes.get('/', (c) => {
  const items: WorkspaceSummary[] = getStack().knownWorkspaces.list().map((w) => ({
    path: w.path,
    lastUsedAt: w.lastUsedAt,
  }))
  return c.json({ ok: true, items })
})

workspaceRoutes.delete('/', async (c) => {
  const body = RemoveBody.parse(await c.req.json())
  getStack().knownWorkspaces.remove(body.path)
  return c.json({ ok: true })
})
