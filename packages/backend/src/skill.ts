import { join } from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import { importSkill, SkillImportError, toSkillIndex } from '@anubis/conversation'
import { getDataDir, getStack } from './services.js'

export const skillRoutes = new Hono()

const importBody = z.object({
  sourcePath: z.string().min(1),
  kind: z.enum(['folder', 'zip']),
  category: z.enum(['auto', 'opt-in', 'user']),
})

skillRoutes.get('/', (c) => {
  const all = getStack().skills.discoverAll().map(toSkillIndex)
  return c.json({ ok: true, items: all })
})

skillRoutes.post('/import', async (c) => {
  const body = importBody.parse(await c.req.json())
  const stk = getStack()
  try {
    const result = importSkill({
      sourcePath: body.sourcePath,
      kind: body.kind,
      category: body.category,
      userSkillsRoot: join(getDataDir(), 'skills'),
    })
    stk.skills.reload()
    return c.json({
      ok: true,
      name: result.name,
      source: result.source,
      count: stk.skills.discoverAll().length,
    })
  } catch (e) {
    if (e instanceof SkillImportError) {
      return c.json({ ok: false, error: e.message }, 400)
    }
    throw e
  }
})

skillRoutes.get('/:name', (c) => {
  const s = getStack().skills.byName(c.req.param('name'))
  if (!s) return c.json({ ok: false, error: 'not_found' }, 404)
  return c.json({ ok: true, skill: s })
})

skillRoutes.post('/reload', (c) => {
  const stk = getStack()
  stk.skills.reload()
  return c.json({ ok: true, count: stk.skills.discoverAll().length })
})
