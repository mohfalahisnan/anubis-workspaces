import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { Hono } from 'hono'
import { z } from 'zod'
import { type Profile, hasCredentials, ensureAgentHome, envFor } from '@anubis/conversation'
import { AGENT_NOT_INSTALLED_ERROR_CODE } from '@anubis/shared'
import { getStack } from './services.js'

const ProfileConfig = z.object({
  agent: z.enum(['claude', 'codex', 'antigravity', 'gpt-web', 'qwen-web']),
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
  const created = stack.profiles.copyProfile(c.req.param('id'), body)
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
  if (agent === 'gpt-web') {
    return c.json({ ok: false, error: 'Terminal login not supported for ChatGPT Web. Please log in via the browser.' }, 400)
  }
  if (agent === 'qwen-web') {
    return c.json({ ok: false, error: 'Terminal login not supported for Qwen Web. Please log in via the browser.' }, 400)
  }
  const availability = stack.aiAgent.catalog().agentAvailability[agent]
  if (!availability.available) {
    return c.json(
      {
        ok: false,
        error: { code: AGENT_NOT_INSTALLED_ERROR_CODE, agent, message: `${agent} CLI is not on PATH. Install it first.` },
      },
      409,
    )
  }

  const home = ensureAgentHome(stack.agentHomeRoot, profileId, agent).path
  const homeEnv = envFor(agent, home)
  const env = { ...process.env, ...homeEnv } as Record<string, string>
  // The single config-dir env var this agent uses (CLAUDE_CONFIG_DIR /
  // CODEX_HOME / GEMINI_CONFIG_DIR), so the *nix terminal lines can export it
  // without re-deriving per agent.
  const [envVar] = Object.keys(homeEnv)

  // Prefer the absolute path resolved by detectAgents() (handles Windows
  // .cmd shims) over the bare binary name.
  const FALLBACK_BINARY: Record<typeof agent, string> = {
    claude: 'claude',
    codex: 'codex',
    antigravity: 'agy',
  }
  const commandOverride =
    agent === 'claude' ? process.env.ANUBIS_CLAUDE_COMMAND
    : agent === 'codex' ? process.env.ANUBIS_CODEX_COMMAND
    : process.env.ANUBIS_ANTIGRAVITY_COMMAND
  const command = commandOverride ?? availability.path ?? FALLBACK_BINARY[agent]
  // codex needs an explicit `login` subcommand; claude and agy trigger their
  // OAuth flow on first interactive launch.
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
    const cmdStr = `cd ${JSON.stringify(home)} && ${envVar}=${JSON.stringify(home)} ${command} ${args.join(' ')}`
    spawn('osascript', ['-e', `tell application "Terminal" to do script ${JSON.stringify(cmdStr)}`], {
      detached: true,
      stdio: 'ignore',
    }).unref()
  } else {
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
