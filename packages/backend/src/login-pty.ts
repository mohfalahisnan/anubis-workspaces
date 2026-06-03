import { watch, type FSWatcher } from 'node:fs'
import type { Hono } from 'hono'
import type { WSContext } from 'hono/ws'
import * as pty from 'node-pty'
import { ensureAgentHome, envFor, hasCredentials } from '@anubis/conversation'
import { getStack } from './services.js'

// Track active sessions so we can reject duplicates for the same profile.
const active = new Set<string>()

type UpgradeWebSocket = ReturnType<
  typeof import('@hono/node-ws').createNodeWebSocket
>['upgradeWebSocket']

export function registerLoginPty(app: Hono, upgradeWebSocket: UpgradeWebSocket): void {
  app.get(
    '/profiles/:id/login',
    upgradeWebSocket((c) => {
      const profileId = c.req.param('id') ?? ''
      const stack = getStack()
      const profile = stack.profiles.get(profileId)

      let proc: pty.IPty | null = null
      let watcher: FSWatcher | null = null

      function send(ws: WSContext, payload: unknown): void {
        try { ws.send(JSON.stringify(payload)) } catch { /* swallow */ }
      }

      return {
        onOpen(_evt, ws) {
          if (!profile) {
            send(ws, { type: 'failed', message: 'profile not found' })
            try { ws.close() } catch { /* */ }
            return
          }
          if (active.has(profileId)) {
            send(ws, { type: 'failed', message: 'login already in progress for this profile' })
            try { ws.close() } catch { /* */ }
            return
          }
          active.add(profileId)

          const agent = profile.config.agent
          const home = ensureAgentHome(stack.agentHomeRoot, profileId, agent).path
          const env = { ...process.env, ...envFor(agent, home) } as Record<string, string>
          const command = agent === 'claude'
            ? (process.env.ANUBIS_CLAUDE_COMMAND ?? 'claude')
            : (process.env.ANUBIS_CODEX_COMMAND ?? 'codex')
          const args = agent === 'codex' ? ['login'] : []

          try {
            proc = pty.spawn(command, args, {
              name: 'xterm-256color',
              cols: 100,
              rows: 30,
              cwd: home,
              env,
            })
          } catch (e) {
            send(ws, { type: 'failed', message: e instanceof Error ? e.message : String(e) })
            active.delete(profileId)
            try { ws.close() } catch { /* */ }
            return
          }

          proc.onData((chunk) => send(ws, { type: 'data', data: chunk }))
          proc.onExit(({ exitCode }) => {
            send(ws, { type: 'exited', exitCode })
            try { ws.close() } catch { /* */ }
          })

          watcher = watch(home, { persistent: false }, () => {
            if (hasCredentials(profileId, agent, stack.agentHomeRoot)) {
              send(ws, { type: 'logged-in' })
              try { proc?.kill() } catch { /* */ }
              try { ws.close() } catch { /* */ }
            }
          })
        },
        onMessage(evt, _ws) {
          try {
            const raw = typeof evt.data === 'string'
              ? evt.data
              : new TextDecoder().decode(evt.data as ArrayBuffer)
            const m = JSON.parse(raw) as
              | { type: 'input'; data: string }
              | { type: 'resize'; cols: number; rows: number }
            if (m.type === 'input') proc?.write(m.data)
            else if (m.type === 'resize') proc?.resize(m.cols, m.rows)
          } catch {
            // swallow malformed
          }
        },
        onClose() {
          watcher?.close()
          watcher = null
          try { proc?.kill() } catch { /* */ }
          proc = null
          active.delete(profileId)
        },
        onError(err) {
          // eslint-disable-next-line no-console
          console.warn('[login-pty] ws error:', err)
        },
      }
    }),
  )
}
