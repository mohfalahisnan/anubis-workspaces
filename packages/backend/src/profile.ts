import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { Hono } from 'hono'
import { z } from 'zod'
import { type Profile, hasCredentials, ensureAgentHome, envFor } from '@anubis/conversation'
import { getStack } from './services.js'

const ProfileConfig = z.object({
  agent: z.enum(['claude', 'codex']),
}).passthrough()

const CreateBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  config: ProfileConfig,
}).strict()

const UpdateBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  configPatch: z.record(z.string(), z.unknown()).optional(),
  sortOrder: z.number().int().optional(),
}).strict()

const ResolveBody = z.object({
  override: z.record(z.string(), z.unknown()).optional(),
}).strict()

/**
 * Enriches a profile payload with the on-disk path of its isolated
 * agent home, so the UI can surface "Home: …/agent-homes/<id>/<agent>"
 * and offer a "Reset" affordance.
 */
function withHome(profile: Profile) {
  const path = getStack().conversation.agentHomePath(profile.id, profile.config.agent)
  return {
    ...profile,
    home: {
      path,
      exists: existsSync(path),
      hasCredentials: hasCredentials(profile.id, profile.config.agent, getStack().agentHomeRoot),
    },
  }
}

export const profileRoutes = new Hono()

profileRoutes.get('/', (c) => {
  const items = getStack().profiles.list().map(withHome)
  return c.json({ ok: true, items })
})

profileRoutes.get('/:id', (c) => {
  const p = getStack().profiles.get(c.req.param('id'))
  if (!p) return c.json({ ok: false, error: 'not_found' }, 404)
  return c.json({ ok: true, profile: withHome(p) })
})

profileRoutes.post('/', async (c) => {
  const body = CreateBody.parse(await c.req.json())
  const p = getStack().profiles.create(body as never)
  return c.json({ ok: true, profile: withHome(p) }, 201)
})

const CopyBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
}).strict()

profileRoutes.post('/:id/copy', async (c) => {
  const body = CopyBody.parse(await c.req.json())
  const stack = getStack()
  const created = stack.profiles.copyProfile(c.req.param('id'), {
    ...body,
    agentHomeRoot: stack.agentHomeRoot,
  })
  return c.json({ ok: true, profile: withHome(created) }, 201)
})

profileRoutes.patch('/:id', async (c) => {
  const body = UpdateBody.parse(await c.req.json())
  const p = getStack().profiles.update(c.req.param('id'), body as never)
  return c.json({ ok: true, profile: withHome(p) })
})

profileRoutes.delete('/:id', (c) => {
  getStack().profiles.delete(c.req.param('id'))
  return c.json({ ok: true })
})

profileRoutes.post('/:id/resolve', async (c) => {
  const body = ResolveBody.parse(await c.req.json().catch(() => ({})))
  const r = getStack().profiles.resolve(c.req.param('id'), body.override as never)
  return c.json({ ok: true, resolved: r })
})

// Dedup: a recent /login/terminal request for the same profile is treated as
// a no-op so React re-renders / accidental double-clicks don't pile up windows.
const recentTerminalLaunches = new Map<string, number>()
const TERMINAL_DEDUP_MS = 3000

profileRoutes.post('/:id/login/terminal', async (c) => {
  const profileId = c.req.param('id')
  const stack = getStack()
  const profile = stack.profiles.get(profileId)
  if (!profile) return c.json({ ok: false, error: 'not_found' }, 404)

  const now = Date.now()
  const last = recentTerminalLaunches.get(profileId) ?? 0
  if (now - last < TERMINAL_DEDUP_MS) {
    return c.json({ ok: true, deduped: true })
  }
  recentTerminalLaunches.set(profileId, now)

  const agent = profile.config.agent
  const availability = stack.aiAgent.catalog().agentAvailability[agent]
  if (!availability.available) {
    return c.json(
      {
        ok: false,
        error: { code: 'agent_not_installed', agent, message: `${agent} CLI is not on PATH. Install it first.` },
      },
      409,
    )
  }

  const home = ensureAgentHome(stack.agentHomeRoot, profileId, agent).path
  const env = { ...process.env, ...envFor(agent, home) } as Record<string, string>

  // Prefer the absolute path resolved by detectAgents() (handles Windows
  // .cmd shims) over a bare 'codex' / 'claude' name.
  const command = (agent === 'claude'
    ? process.env.ANUBIS_CLAUDE_COMMAND
    : process.env.ANUBIS_CODEX_COMMAND)
    ?? availability.path
    ?? agent
  const args = agent === 'codex' ? ['login'] : []

  if (process.platform === 'win32') {
    const cmdStr = `${command} ${args.join(' ')}`
    spawn('cmd.exe', ['/c', 'start', 'cmd', '/k', cmdStr], {
      cwd: home,
      env,
      detached: true,
      stdio: 'ignore',
    }).unref()
  } else if (process.platform === 'darwin') {
    const cmdStr = `cd ${JSON.stringify(home)} && ${envFor(agent, home)[agent === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME']}=${JSON.stringify(home)} ${command} ${args.join(' ')}`
    spawn('osascript', ['-e', `tell application "Terminal" to do script ${JSON.stringify(cmdStr)}`], {
      detached: true,
      stdio: 'ignore',
    }).unref()
  } else {
    const envVar = agent === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME'
    spawn('x-terminal-emulator', ['-e', 'sh', '-c', `cd ${JSON.stringify(home)} && ${envVar}=${JSON.stringify(home)} ${command} ${args.join(' ')}`], {
      detached: true,
      stdio: 'ignore',
    }).unref()
  }

  return c.json({ ok: true })
})

profileRoutes.post('/:id/reset-home', (c) => {
  const id = c.req.param('id')
  const p = getStack().profiles.get(id)
  if (!p) return c.json({ ok: false, error: 'not_found' }, 404)
  const result = getStack().conversation.resetProfileHome(id, p.config.agent)
  return c.json({ ok: true, existed: result.existed })
})
