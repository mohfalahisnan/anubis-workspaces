import { Hono } from 'hono'
import { z } from 'zod'
import { getStack } from './services.js'

const PLATFORM = z.enum([
  'instagram', 'tiktok', 'youtube', 'facebook', 'linkedin', 'x', 'threads', 'general',
])
const TASK_TYPE = z.enum([
  'analyze_competitor', 'build_brief', 'generate_content',
  'rewrite_content', 'review_content', 'create_calendar',
])

const BuildBody = z.object({
  workspaceId: z.string().min(1),
  platform: PLATFORM,
  taskType: TASK_TYPE,
  query: z.string().min(1),
  objective: z.string().min(1),
  campaignId: z.string().min(1).optional(),
  limitPerBucket: z.number().int().positive().max(20).optional(),
}).strict()

export const contentMemoryRoutes = new Hono()

contentMemoryRoutes.post('/context-pack', async (c) => {
  const body = BuildBody.parse(await c.req.json())
  const { pack, packId } = await getStack().contentMemory.buildForContentTask(body)
  return c.json({ ok: true, packId, pack })
})
