import { Hono } from 'hono'
import { z } from 'zod'
import { getStack } from './services.js'

/* -----------------------------------------------------------
   App config routes
   -----------------------------------------------------------
   Per-machine settings the user changes via the Settings page.
   The conversation stack persists this to {dataDir}/config.json
   and caches it in memory; the capture + discover handlers
   read it before each crawler call so any change takes effect
   immediately without a backend restart.

   GET    /config            → current config
   PATCH  /config            → merge a patch and return the
                               persisted result. Empty strings
                               are treated as "unset" so the
                               form can clear values.
   ----------------------------------------------------------- */

const PatchBody = z.object({
  chromePath: z.string().optional(),
}).strict()

export const configRoutes = new Hono()

configRoutes.get('/', (c) => {
  return c.json({ ok: true, config: getStack().appConfig.get() })
})

configRoutes.patch('/', async (c) => {
  const body = PatchBody.parse(await c.req.json())
  const merged = getStack().appConfig.update(body)
  return c.json({ ok: true, config: merged })
})
