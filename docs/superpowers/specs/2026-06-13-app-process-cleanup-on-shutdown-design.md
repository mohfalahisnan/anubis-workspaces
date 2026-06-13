# Targeted app-process cleanup on shutdown

**Date:** 2026-06-13
**Status:** Approved (pending spec review)

## Problem

Closing the Anubis desktop app does not reliably terminate everything it spawned.
Leftover processes cause two recurring, user-visible failures on Windows:

1. **Crawler Chrome squats CDP ports.** Chrome is launched `detached: true` +
   `child.unref()` ([launch-chrome.ts:91](../../../packages/research-crawler/src/core/chrome/launch-chrome.ts)),
   so it survives the app and even survives switching between the dev and packaged
   builds. A subsequent run finds a foreign profile dir on the port and the reuse
   guard throws `Port 9223 is in use by a Chrome with a different profile dir …`.
2. **Installer / auto-updater blocked.** A surviving backend `Anubis.exe`
   (the `ELECTRON_RUN_AS_NODE` child) keeps install-dir native modules
   (`better-sqlite3.node`, `node-pty`) locked, so NSIS reports *"the app must be
   closed first"* even after the user closed the window.

### Why today's cleanup misses them

`before-quit` runs `killBackendTree()` = `taskkill /pid <backend> /T /F`
([backend.ts:133](../../../apps/desktop/electron/main/backend.ts)). This only walks
the *current* backend's process tree, which fails in the exact scenarios above:

- **Detached Chrome** decouples from the backend and reparents. An orphan whose
  ancestor backend has already exited can never be reached by a tree walk.
- **Hard close / crash / Task Manager kill** → `before-quit` may not fire at all,
  leaving the whole tree (including the install-dir-locking backend) alive.
- **`quitAndInstall`** fires `before-quit`, but any escaped detached child outlives
  it.

## Goals

- On app shutdown, terminate every process that belongs to this app.
- Self-heal: on launch, clear orphans left by a previous unclean exit.
- Never kill the user's personal Chrome or unrelated `node.exe` processes.
- No new native dependencies (avoid the root-`package.json` packaging trap and
  ABI-rebuild risk).

## Non-goals

- A Windows Job Object (kill-on-job-close) approach. Rejected: needs a native
  addon. Documented as a future option if the crash gap below ever bites.
- An NSIS pre-install kill script. Rejected for now; see Known Gap.

## Approach: targeted signature sweep

A single sweep finds and kills **only** this app's processes, matched by two
signatures precise enough that they cannot match personal browsing or unrelated
node processes.

### Signatures

- **(a) App binaries** — processes whose executable path is under the install dir
  (`dirname(process.execPath)`). In the packaged app this is `Anubis.exe` (the
  Electron main *and* the `ELECTRON_RUN_AS_NODE` backend child). These are what
  lock install-dir DLLs and trigger the NSIS "app is running" check. The current
  process (`process.pid`) is always excluded.
- **(b) Crawler Chrome** — `chrome.exe` whose `--user-data-dir` matches the
  crawler signature: a path ending in
  `chrome-profiles\chrome-profile-(login|public|flow)`. This segment is unique to
  Anubis, so the user's normal Chrome (which has no such `--user-data-dir`) is
  untouched. The match is intentionally **data-root agnostic**, so it also catches
  dev-dir orphans (e.g. `%APPDATA%\Electron\anubis\…`) — acceptable because dev and
  packaged builds must not run simultaneously (they fight over ports 9222/9223/9224).

Each matched PID is killed with `taskkill /T /F` (tree kill). While the backend is
still alive, this also sweeps up its node-pty shells and agent CLIs (codex / claude
via the `cmd.exe` shim) as descendants. Truly orphaned agent CLIs are external
binaries that do **not** live in the install dir, so they neither block installs
nor justify the false-positive risk of signature-matching `node.exe`.

## Components

New file: `apps/desktop/electron/main/process-cleanup.ts` (self-contained in the
Electron-main bundle — it does not import workspace packages, matching how
`backend.ts` keeps its own `killBackendTree`).

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `selectAppProcesses(procs, opts)` | **Pure function.** Given a process list and `{ installDir, selfPid, profileSig }`, return the PIDs to kill. No I/O. | — |
| `enumerateProcesses()` | Windows: one `Get-CimInstance Win32_Process` call (same mechanism as [launch-chrome.ts:156](../../../packages/research-crawler/src/core/chrome/launch-chrome.ts)) → `{ pid, name, exePath, commandLine }[]`. Best-effort `[]` elsewhere / on failure. | child_process |
| `killTree(pid, deps?)` | `taskkill /T /F` (win) / `SIGKILL` (posix). Best-effort; swallows all errors. | child_process |
| `sweepAppProcesses({ sync })` | Orchestrate enumerate → select → kill. `sync: true` uses `spawnSync`/`execSync` for `before-quit`; async otherwise. | the three units above |

`selectAppProcesses` carries the testable logic; `enumerateProcesses` / `killTree`
are thin platform shims with dependency-injection seams (mirroring
`KillProcessTreeDeps` in [process-tree.ts](../../../packages/ai-agent/src/agents/process-tree.ts)).

### Path matching details

- Compare executable paths case-insensitively on Windows, after normalizing
  separators and stripping trailing slashes (reuse the `pathsMatch` normalization
  style from launch-chrome).
- `installDir` derives from `dirname(process.execPath)`. In dev (`process.execPath`
  is the Electron/node binary, not under an install dir) signature (a) will simply
  match nothing — the sweep is a no-op for app binaries in dev, which is correct.
- `profileSig` is a regex on the `--user-data-dir` value:
  `/[\\/]chrome-profiles[\\/]chrome-profile-(login|public|flow)/i`.

## Wiring (call sites)

1. **`before-quit`** ([index.ts:169](../../../apps/desktop/electron/main/index.ts)):
   keep `stopBackend?.()`, then `sweepAppProcesses({ sync: true })`. Synchronous so
   it completes before the process exits (same constraint that made
   `killBackendTree` use `spawnSync`).
2. **Startup pre-flight** — at the top of the `whenReady` handler, **before**
   `startBackend`: `await sweepAppProcesses()`. Kills orphans from a prior unclean
   exit (excluding self), self-healing crashes and pre-empting the CDP port
   conflict. Runs after `requestSingleInstanceLock` so it never targets a legitimate
   second launch (that path already calls `app.quit()`).
3. **`quit-and-install`** ([update.ts:81](../../../apps/desktop/electron/main/update.ts)):
   `await sweepAppProcesses()` before `autoUpdater.quitAndInstall(false, true)`, so
   the updater never races a surviving child.

## Known gap

If the app is killed via Task Manager / crash **and** the user then runs a
*downloaded* installer **without relaunching the app first**, that crash-orphan
cannot be swept (no app process is running to perform the sweep). Normal closes,
in-app auto-updates, and the next normal launch are all fully covered. Closing this
last gap would require the rejected NSIS pre-install script or a Job Object; revisit
only if it occurs in practice.

## Testing

- **Unit (`selectAppProcesses`)** against fixture process lists:
  - picks `Anubis.exe` under the install dir; **excludes** `selfPid`.
  - picks `chrome.exe` with a matching crawler `--user-data-dir`.
  - **excludes** a personal `chrome.exe` with no / unrelated `--user-data-dir`.
  - **excludes** unrelated `node.exe` and an `Anubis.exe` outside the install dir.
  - matches crawler Chrome regardless of data root (dev vs packaged path).
- **Manual:** launch packaged app → quit → confirm no `Anubis.exe` and no crawler
  Chrome remain. Plant an orphan (launch crawler Chrome, hard-kill the app) →
  relaunch → confirm pre-flight cleared it and the install/update proceeds.

## Risks & mitigations

- *Killing a concurrently-running dev session's Chrome.* Accepted: dev + packaged
  must not run together; documented in the existing
  `chrome-cdp-port-orphan-datadir-drift` memory.
- *PowerShell enumeration latency in `before-quit`.* A single CIM query is a few
  hundred ms; the existing sync `taskkill` already accepts this cost. Best-effort
  and time-bounded so a slow query never hangs quit.
