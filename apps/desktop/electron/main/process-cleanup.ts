import { execSync, spawnSync } from 'node:child_process'

export interface ProcInfo {
  pid: number
  name: string
  exePath: string
  commandLine: string
}

export interface SelectOptions {
  installDir: string
  selfPid: number
  /** Defaults to process.platform; tests pass it explicitly for determinism. */
  platform?: NodeJS.Platform
}

/** Path segment unique to this app's crawler Chrome profiles. */
const CRAWLER_PROFILE_SIG = /[\\/]chrome-profiles[\\/]chrome-profile-(login|public|flow)/i

function isUnder(childPath: string, parentDir: string, platform: NodeJS.Platform): boolean {
  const norm = (s: string) => {
    const trimmed = s.replace(/[\\/]+$/, '')
    return platform === 'win32' ? trimmed.toLowerCase() : trimmed
  }
  const c = norm(childPath)
  const p = norm(parentDir)
  if (!p || !c) return false
  return c === p || c.startsWith(p + '/') || c.startsWith(p + '\\')
}

/**
 * Pure selector: given a process snapshot, return the PIDs that belong to this
 * app and should be terminated. Matches two signatures and never the current
 * process:
 *   (a) executable path under the install dir (the app binaries), and
 *   (b) Chrome whose --user-data-dir is one of the crawler profile dirs.
 */
export function selectAppProcesses(procs: ProcInfo[], opts: SelectOptions): number[] {
  const platform = opts.platform ?? process.platform
  const targets: number[] = []
  for (const p of procs) {
    if (p.pid <= 0 || p.pid === opts.selfPid) continue
    if (p.exePath && isUnder(p.exePath, opts.installDir, platform)) {
      targets.push(p.pid)
      continue
    }
    if (/chrome/i.test(p.name) && CRAWLER_PROFILE_SIG.test(p.commandLine)) {
      targets.push(p.pid)
    }
  }
  return targets
}

/** Snapshot running processes. Windows-only; best-effort [] elsewhere/on error. */
export function enumerateProcesses(platform: NodeJS.Platform = process.platform): ProcInfo[] {
  if (platform !== 'win32') return []
  try {
    const raw = execSync(
      'powershell.exe -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process | Select-Object ProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress"',
      { timeout: 5000, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
    ).toString()
    const parsed = JSON.parse(raw) as unknown
    const arr = Array.isArray(parsed) ? parsed : [parsed]
    return arr.map((row) => {
      const r = row as Record<string, unknown>
      return {
        pid: typeof r.ProcessId === 'number' ? r.ProcessId : Number(r.ProcessId) || 0,
        name: typeof r.Name === 'string' ? r.Name : '',
        exePath: typeof r.ExecutablePath === 'string' ? r.ExecutablePath : '',
        commandLine: typeof r.CommandLine === 'string' ? r.CommandLine : '',
      }
    })
  } catch {
    return []
  }
}

/** Force-kill a process and its descendant tree. Best-effort. */
export function killTree(pid: number, platform: NodeJS.Platform = process.platform): void {
  if (!pid || pid <= 0) return
  try {
    if (platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
        timeout: 5000,
      })
    } else {
      process.kill(pid, 'SIGKILL')
    }
  } catch {
    /* best-effort: process may already be gone */
  }
}

/**
 * Enumerate -> select -> kill. Synchronous so it can run in `before-quit`
 * before the process exits. Returns the PIDs it targeted (for logging/tests).
 */
export function sweepAppProcesses(opts: { installDir: string; selfPid: number }): number[] {
  const targets = selectAppProcesses(enumerateProcesses(), {
    installDir: opts.installDir,
    selfPid: opts.selfPid,
  })
  for (const pid of targets) killTree(pid)
  return targets
}
