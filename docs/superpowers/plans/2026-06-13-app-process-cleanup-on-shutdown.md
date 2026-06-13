# App Process Cleanup on Shutdown — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Terminate every Anubis-owned process (app binaries + crawler Chrome) on app quit, on startup pre-flight, and before an in-app update install — fixing orphaned-CDP-port and "app must be closed" installer errors.

**Architecture:** A self-contained Electron-main module (`process-cleanup.ts`) with a pure, unit-tested selector that matches processes by two precise signatures (executable path under the install dir; Chrome `--user-data-dir` under a crawler profile dir), plus thin Windows shims to enumerate and tree-kill. Wired into three call sites in `index.ts` and `update.ts`. One synchronous sweep function serves all three sites.

**Tech Stack:** TypeScript (ESM), Electron main (vite-plugin-electron bundle, extensionless local imports), `node:child_process` (`Get-CimInstance Win32_Process` + `taskkill /T /F`), Vitest.

**Spec:** [docs/superpowers/specs/2026-06-13-app-process-cleanup-on-shutdown-design.md](../specs/2026-06-13-app-process-cleanup-on-shutdown-design.md)

**Note on sync-only:** The spec mentioned sync/async variants. This plan implements a single **synchronous** `sweepAppProcesses` (YAGNI): `before-quit` requires sync, and a one-shot CIM query (~hundreds of ms) is acceptable at startup and at install-click. All three call sites use the same function.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `apps/desktop/electron/main/process-cleanup.ts` | Pure selector + enumerate/kill shims + sync sweep orchestrator. No electron import (so it's unit-testable). | Create |
| `test/process-cleanup.test.ts` | Unit tests for the pure `selectAppProcesses`. Collected by root vitest (`test/**`). | Create |
| `apps/desktop/electron/main/index.ts` | Wire sweep into `before-quit` and startup pre-flight. | Modify |
| `apps/desktop/electron/main/update.ts` | Wire sweep into `quit-and-install` before handoff to NSIS. | Modify |

---

## Task 1: Process-cleanup module (pure selector + shims + sweep)

**Files:**
- Test: `test/process-cleanup.test.ts`
- Create: `apps/desktop/electron/main/process-cleanup.ts`

- [ ] **Step 1: Write the failing test**

Create `test/process-cleanup.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { selectAppProcesses, type ProcInfo } from '../apps/desktop/electron/main/process-cleanup'

const INSTALL = 'C:\\Users\\User\\AppData\\Local\\Programs\\Anubis'

function proc(p: Partial<ProcInfo> & { pid: number }): ProcInfo {
  return { name: '', exePath: '', commandLine: '', ...p }
}

describe('selectAppProcesses', () => {
  it('selects app binaries under the install dir, excluding self', () => {
    const procs = [
      proc({ pid: 100, name: 'Anubis.exe', exePath: INSTALL + '\\Anubis.exe' }), // main (self)
      proc({ pid: 101, name: 'Anubis.exe', exePath: INSTALL + '\\Anubis.exe' }), // backend child
    ]
    expect(selectAppProcesses(procs, { installDir: INSTALL, selfPid: 100, platform: 'win32' }))
      .toEqual([101])
  })

  it('selects crawler Chrome by --user-data-dir signature, any data root', () => {
    const dev = proc({
      pid: 200, name: 'chrome.exe',
      commandLine: 'chrome.exe --user-data-dir="C:\\Users\\User\\AppData\\Roaming\\Electron\\anubis\\chrome-profiles\\chrome-profile-public" --headless',
    })
    const packaged = proc({
      pid: 201, name: 'chrome.exe',
      commandLine: 'chrome.exe --user-data-dir=C:\\Users\\User\\AppData\\Roaming\\Anubis\\anubis\\chrome-profiles\\chrome-profile-login',
    })
    expect(selectAppProcesses([dev, packaged], { installDir: INSTALL, selfPid: 1, platform: 'win32' }).sort())
      .toEqual([200, 201])
  })

  it('does NOT select the user personal Chrome', () => {
    const renderer = proc({ pid: 300, name: 'chrome.exe', commandLine: 'chrome.exe --type=renderer' })
    const personal = proc({
      pid: 301, name: 'chrome.exe',
      commandLine: 'chrome.exe --user-data-dir="C:\\Users\\User\\AppData\\Local\\Google\\Chrome\\User Data"',
    })
    expect(selectAppProcesses([renderer, personal], { installDir: INSTALL, selfPid: 1, platform: 'win32' }))
      .toEqual([])
  })

  it('does NOT select unrelated node.exe or Anubis.exe outside the install dir', () => {
    const node = proc({ pid: 400, name: 'node.exe', exePath: 'C:\\Program Files\\nodejs\\node.exe', commandLine: 'node server.js' })
    const otherAnubis = proc({ pid: 401, name: 'Anubis.exe', exePath: 'D:\\dev\\other\\Anubis.exe' })
    expect(selectAppProcesses([node, otherAnubis], { installDir: INSTALL, selfPid: 1, platform: 'win32' }))
      .toEqual([])
  })

  it('matches case-insensitively on win32 and handles trailing slash on install dir', () => {
    const p = proc({ pid: 500, name: 'anubis.exe', exePath: 'c:\\users\\user\\appdata\\local\\programs\\anubis\\Anubis.exe' })
    expect(selectAppProcesses([p], { installDir: INSTALL + '\\', selfPid: 1, platform: 'win32' }))
      .toEqual([500])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/process-cleanup.test.ts`
Expected: FAIL — cannot resolve `../apps/desktop/electron/main/process-cleanup` (module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `apps/desktop/electron/main/process-cleanup.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/process-cleanup.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck the desktop package**

Run: `pnpm --filter @anubis/desktop typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/electron/main/process-cleanup.ts test/process-cleanup.test.ts
git commit -m "feat(desktop): add targeted app-process cleanup module"
```

---

## Task 2: Wire sweep into app lifecycle (before-quit + startup pre-flight)

**Files:**
- Modify: `apps/desktop/electron/main/index.ts` (import; `whenReady` top; `before-quit`)

No unit test (Electron lifecycle integration); verified by typecheck here and manual verification in Task 4. `path` is already imported at [index.ts:3](../../../apps/desktop/electron/main/index.ts).

- [ ] **Step 1: Add the import**

In `apps/desktop/electron/main/index.ts`, add below the existing `import { update } from './update'` line:

```ts
import { sweepAppProcesses } from './process-cleanup'
```

- [ ] **Step 2: Add the startup pre-flight sweep**

In the `app.whenReady().then(async () => {` body, make the FIRST statement (before `const backendRoot = ...`):

```ts
  // Clear orphans left by a previous unclean exit (crash, Task Manager kill)
  // before we start a new backend — self-heals stuck installs and frees the
  // crawler CDP ports. Excludes this process via process.pid.
  sweepAppProcesses({ installDir: path.dirname(process.execPath), selfPid: process.pid })
```

It runs after `requestSingleInstanceLock()` (top of file), so a legitimate second launch has already `app.quit()`-ed and never reaches here.

- [ ] **Step 3: Add the sweep to before-quit**

Replace the existing handler:

```ts
app.on('before-quit', () => {
  stopBackend?.()
})
```

with:

```ts
app.on('before-quit', () => {
  stopBackend?.()
  // Belt-and-suspenders: kill any app binary / crawler Chrome that escaped the
  // backend tree (detached Chrome reparents and survives killBackendTree).
  sweepAppProcesses({ installDir: path.dirname(process.execPath), selfPid: process.pid })
})
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @anubis/desktop typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/main/index.ts
git commit -m "feat(desktop): sweep app processes on quit and startup pre-flight"
```

---

## Task 3: Wire sweep into in-app update install

**Files:**
- Modify: `apps/desktop/electron/main/update.ts` (imports; `quit-and-install` handler at [update.ts:81](../../../apps/desktop/electron/main/update.ts))

- [ ] **Step 1: Add imports**

At the top of `apps/desktop/electron/main/update.ts`, after the existing `import updater from 'electron-updater'` line, add:

```ts
import path from 'node:path'
import { sweepAppProcesses } from './process-cleanup'
```

- [ ] **Step 2: Sweep before handing off to NSIS**

Replace the existing handler:

```ts
  ipcMain.handle('quit-and-install', () => {
    autoUpdater.quitAndInstall(false, true)
  })
```

with:

```ts
  ipcMain.handle('quit-and-install', () => {
    // Kill the backend Anubis.exe + crawler Chrome now, so NSIS never races a
    // surviving child holding install-dir DLLs. quitAndInstall also fires
    // before-quit, but doing it here guarantees completion before handoff.
    sweepAppProcesses({ installDir: path.dirname(process.execPath), selfPid: process.pid })
    autoUpdater.quitAndInstall(false, true)
  })
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @anubis/desktop typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/electron/main/update.ts
git commit -m "feat(desktop): sweep app processes before in-app update install"
```

---

## Task 4: Manual verification (packaged build)

**Files:** none (verification only). Requires a packaged build; run by the user/maintainer, not a subagent.

- [ ] **Step 1: Build and install the packaged app**

Run: `pnpm build`
Expected: build completes; installer produced under `release/<version>/`. Install it.

- [ ] **Step 2: Verify quit cleanup**

Launch Anubis, run any Instagram capture (so a crawler Chrome on 9222/9223/9224 exists), then quit the app via the window close button. In PowerShell:

```powershell
Get-Process Anubis -ErrorAction SilentlyContinue
Get-NetTCPConnection -LocalPort 9222,9223,9224 -State Listen -ErrorAction SilentlyContinue
```

Expected: no `Anubis` processes; no listeners on the CDP ports.

- [ ] **Step 3: Verify your personal Chrome is untouched**

With your normal Chrome open, repeat Step 2's quit.
Expected: your personal Chrome windows remain open (only crawler-profile Chrome is killed).

- [ ] **Step 4: Verify startup pre-flight self-heal**

Launch Anubis, start a capture, then hard-kill only the main window's process tree leaving a detached crawler Chrome alive (or reproduce a real crash). Confirm a leftover Chrome on a CDP port exists, then relaunch Anubis.
Expected: on relaunch the leftover crawler Chrome is gone (pre-flight swept it); a fresh capture works without the "different profile dir" error.

- [ ] **Step 5: Verify update install no longer blocks**

With a newer version published, use the in-app updater (download → install).
Expected: install proceeds without the "app must be closed first" / "cannot be closed" NSIS error.

---

## Self-Review

- **Spec coverage:**
  - Signature (a) app binaries → `selectAppProcesses` + Task 1 test 1/5; (b) crawler Chrome → test 2/3. ✓
  - `taskkill /T /F` tree kill → `killTree`. ✓
  - Trigger 1 before-quit → Task 2 Step 3. ✓
  - Trigger 2 startup pre-flight → Task 2 Step 2. ✓
  - Trigger 3 before in-app install → Task 3. ✓
  - Personal-Chrome safety → test 3; unrelated node/foreign Anubis safety → test 4. ✓
  - Known gap (crash + external installer) documented in spec; not implemented by design. ✓
- **Placeholder scan:** none.
- **Type consistency:** `ProcInfo`, `SelectOptions`, `selectAppProcesses`, `enumerateProcesses`, `killTree`, `sweepAppProcesses({ installDir, selfPid })` used identically across module, tests, and all three call sites. ✓
