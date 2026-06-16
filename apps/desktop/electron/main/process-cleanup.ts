import { execSync, spawnSync } from 'node:child_process'

export interface ProcInfo {
  pid: number
  name: string
  exePath: string
  commandLine: string
  /** Parent PID, used to spare the current app's own child tree. 0/undefined = unknown. */
  parentPid?: number
}

export interface SelectOptions {
  installDir: string
  selfPid: number
  /** Defaults to process.platform; tests pass it explicitly for determinism. */
  platform?: NodeJS.Platform
  /**
   * When true (default), spare the current process AND its live descendants
   * (Electron GPU / network-service / renderer children, and the backend
   * child). Routine sweeps on `before-quit` / startup use this so they don't
   * force-kill those helpers and log spurious "GPU process exited" noise.
   *
   * Set false on the `quit-and-install` path: there every install-dir process
   * EXCEPT the current pid must die, because the backend Anubis.exe child keeps
   * install-dir native modules (better-sqlite3.node, node-pty) mapped and would
   * make NSIS report "Anubis cannot be closed" while it extracts files.
   */
  spareSelfTree?: boolean
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
 * Collect the current process and all its (transitive) descendants from a
 * snapshot, via parentPid links. These are this app's own live helpers — the
 * Electron GPU / network-service / renderer children all run the install-dir
 * binary, so without this they'd match signature (a) and get force-killed on
 * quit, logging "GPU process exited" / "Network service crashed". Escaped or
 * reparented processes (and orphans from a prior run) lose this ancestry, so
 * they're still caught.
 */
function selfTree(procs: ProcInfo[], selfPid: number): Set<number> {
  const childrenByParent = new Map<number, number[]>()
  for (const p of procs) {
    if (!p.parentPid) continue
    const siblings = childrenByParent.get(p.parentPid) ?? []
    siblings.push(p.pid)
    childrenByParent.set(p.parentPid, siblings)
  }
  const tree = new Set<number>([selfPid])
  const queue = [selfPid]
  while (queue.length) {
    const parent = queue.shift() as number
    for (const child of childrenByParent.get(parent) ?? []) {
      if (!tree.has(child)) {
        tree.add(child)
        queue.push(child)
      }
    }
  }
  return tree
}

/**
 * Pure selector: given a process snapshot, return the PIDs that belong to this
 * app and should be terminated. Matches two signatures and never the current
 * process tree (self + live descendants):
 *   (a) executable path under the install dir (the app binaries), and
 *   (b) Chrome whose --user-data-dir is one of the crawler profile dirs.
 */
export function selectAppProcesses(procs: ProcInfo[], opts: SelectOptions): number[] {
  const platform = opts.platform ?? process.platform
  const spare = (opts.spareSelfTree ?? true)
    ? selfTree(procs, opts.selfPid)
    : new Set<number>([opts.selfPid])
  const targets: number[] = []
  for (const p of procs) {
    if (p.pid <= 0 || spare.has(p.pid)) continue
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
      'powershell.exe -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress"',
      { timeout: 5000, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
    ).toString()
    const parsed = JSON.parse(raw) as unknown
    const arr = Array.isArray(parsed) ? parsed : [parsed]
    return arr.map((row) => {
      const r = row as Record<string, unknown>
      return {
        pid: typeof r.ProcessId === 'number' ? r.ProcessId : Number(r.ProcessId) || 0,
        parentPid: typeof r.ParentProcessId === 'number' ? r.ParentProcessId : Number(r.ParentProcessId) || 0,
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
export function sweepAppProcesses(opts: {
  installDir: string
  selfPid: number
  /** Forwarded to selectAppProcesses; see SelectOptions.spareSelfTree. */
  spareSelfTree?: boolean
}): number[] {
  const targets = selectAppProcesses(enumerateProcesses(), {
    installDir: opts.installDir,
    selfPid: opts.selfPid,
    spareSelfTree: opts.spareSelfTree,
  })
  for (const pid of targets) killTree(pid)
  return targets
}
