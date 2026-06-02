import { Hono } from 'hono'
import { toSkillIndex } from '@anubis/conversation'
import { getStack } from './services.js'

export const skillRoutes = new Hono()

skillRoutes.get('/', (c) => {
  const all = getStack().skills.discoverAll().map(toSkillIndex)
  return c.json({ ok: true, items: all })
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
