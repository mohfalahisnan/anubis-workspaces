import { spawn as nodeSpawn } from 'node:child_process'

export interface KillProcessTreeDeps {
  /** Override platform detection (tests). Defaults to `process.platform`. */
  platform?: NodeJS.Platform
  /** Override the spawn used for the Windows `taskkill` (tests). */
  spawn?: typeof nodeSpawn
  /** Override the POSIX signal sender (tests). */
  kill?: (pid: number, signal: NodeJS.Signals) => void
}

/**
 * Forcibly terminate a process AND its entire descendant tree.
 *
 * The agents are spawned through a `cmd.exe` shim on Windows, so the real
 * agent runs as a grandchild. A plain `child.kill()` would only signal the
 * wrapper and orphan the agent. `taskkill /T` walks the tree; `/F` forces it.
 * On POSIX the agents are spawned directly, so SIGKILL on the pid is enough.
 *
 * Always best-effort: the process may already be gone, so every failure mode
 * (missing taskkill, ESRCH) is swallowed.
 */
export function killProcessTree(pid: number | undefined, deps: KillProcessTreeDeps = {}): void {
  if (!pid || pid <= 0) return
  const platform = deps.platform ?? process.platform
  if (platform === 'win32') {
    const spawnFn = deps.spawn ?? nodeSpawn
    try {
      const child = spawnFn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      })
      // taskkill itself can fail (already exited); never let that surface.
      child.on('error', () => { /* best-effort */ })
    } catch { /* best-effort */ }
  } else {
    const killFn = deps.kill ?? ((p, s) => process.kill(p, s))
    try { killFn(pid, 'SIGKILL') } catch { /* ESRCH: already dead */ }
  }
}
