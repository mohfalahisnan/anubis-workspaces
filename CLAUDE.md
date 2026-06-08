# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)


## Overview

Anubis is an Electron desktop app built as a pnpm monorepo. The Electron main process
spawns a local Hono HTTP backend as a child process; the React renderer talks to that
backend over HTTP. The backend wraps `@anubis/research-crawler`, a CDP-driven
(Chrome DevTools Protocol) browser-automation library that scrapes Instagram and
drives Google Flow.

> Note: `README.md` is the unmodified `electron-vite-react` template and does **not**
> describe this project's actual structure. Trust this file and `packages/research-crawler/README.md` instead.

## Workspace layout

pnpm workspaces (`pnpm-workspace.yaml`): `apps/*` and `packages/*`.

- `apps/desktop` — Electron main + preload (`electron/main`, `electron/preload`). Compiles to `apps/desktop/dist-electron`.
- `packages/frontend` (`@anubis/frontend`) — React 19 + Vite + Tailwind v4 renderer. shadcn/ui + AI Elements components. Builds to `packages/frontend/dist`.
- `packages/backend` (`@anubis/backend`) — Hono server exposing all HTTP routes (see `packages/backend/src/app.ts` for the live list). Mounts `conversation`, `workflow-runtime`, `research-crawler`, and `ai-agent` services.
- `packages/conversation` (`@anubis/conversation`) — conversation/message storage, profile + skill management, agent-home staging (incl. `writeProfileSkills` which materialises auto-inject skills into the workspace's `.agents/skills/<name>/` on every send).
- `packages/workflow-runtime` (`@anubis/workflow-runtime`) — workflow graph schema + executor used by `packages/backend/src/workflow.ts` and `trigger-manager.ts`.
- `packages/research-crawler` (`@anubis/research-crawler`) — internal crawler core. No HTTP/MCP server and no standalone binary packaging.
- `packages/ai-agent` (`@anubis/ai-agent`) — internal Codex/Claude agent core used by backend HTTP routes. Ships auto-inject + opt-in skills under `packages/ai-agent/skills/`.
- `packages/shared` (`@anubis/shared`) — types shared between frontend and backend (e.g. `ApiHealthResponse`).
- `packages/extension` — separate browser extension, not part of the desktop bundle.

Internal deps use `workspace:*`. Package imports inside `@anubis/research-crawler` use explicit
`.js` extensions (ESM/`isolatedModules`), even though sources are `.ts`.

## Commands

Run from the repo root unless noted. Requires Node >= 22.

```sh
pnpm dev          # full desktop dev loop (see scripts/dev.mjs)
pnpm build        # build all packages in order, then electron-builder package
pnpm test         # vitest run (unit tests under test/ and packages/*/tests)
pnpm test:e2e     # pretest build (test mode) + playwright
pnpm typecheck    # tsc --noEmit across every package (-r --if-present)
```

Single test / package-scoped work:

```sh
pnpm vitest run packages/research-crawler/tests/avg-likes.test.ts   # one file
pnpm vitest run -t "name of test"                                   # by test name
pnpm --filter @anubis/research-crawler build # build the crawler package
pnpm --filter @anubis/ai-agent build         # build the agent package
pnpm --filter @anubis/backend dev:server     # run backend alone (tsx, watch-free)
```

Build order is load-bearing: `@anubis/research-crawler` → `@anubis/ai-agent` →
`@anubis/workflow-runtime` → `@anubis/conversation` → `@anubis/backend` →
`@anubis/frontend` → root `vite build`
(electron main/preload) → `electron-builder`. `pretest` builds the first four
plus `vite build --mode=test` before tests run.

## How the desktop app wires together

1. `scripts/dev.mjs` reserves a free port, starts the frontend Vite server on it, builds `@anubis/research-crawler` then the Electron bundle, then launches Electron with `VITE_DEV_SERVER_URL` pointing at the renderer.
2. `apps/desktop/electron/main/backend.ts` spawns the backend as a child process. The port is **static `4317`** in the packaged app (it's the deterministic discovery target documented in the anubis-core auto-inject skill), but dev mode (`scripts/dev.mjs`) reserves a free port and forwards it via `ANUBIS_BACKEND_PORT`. In dev it runs `packages/backend/src/server.ts` via `tsx`; when packaged it runs `packages/backend/dist/server.js` with `ELECTRON_RUN_AS_NODE=1`.
3. The backend prints a JSON line `{"type":"backend-ready","url",...}` on stdout; the main process parses it to learn the URL (15s timeout).
4. The renderer gets the backend URL through the `anubis:get-backend-url` IPC channel, exposed via `contextBridge` as `window.anubis.backend.getBaseUrl()` (see `electron/preload/index.ts` and `packages/frontend/src/api.ts`). Outside Electron the frontend falls back to `VITE_API_BASE_URL` or `http://127.0.0.1:4317`.

Because the port is dynamic, never hardcode the backend URL in the renderer — always go
through `getApiBaseUrl()`. CORS on the backend only allows localhost origins.

## Backend ↔ crawler contract

`packages/backend/src/research-crawler.ts` validates request bodies with Zod and calls the
crawler and agent libraries directly. Routes: `POST /research-crawler/chrome/open`,
`/instagram/capture-profile`, `/instagram/discover`, `GET /ai-agent/catalog`, and
`POST /ai-agent/run`. Backend errors are normalized in `app.ts` (`ZodError` → 400
with issues, else 500).

## research-crawler specifics

- Talks to Chrome over CDP via a `--remote-debugging-port`. It does not bundle a browser; `open-chrome` (or `ensureFlowChrome`) launches/reuses a Chrome instance per profile.
- Three side-by-side Chrome profiles (`packages/research-crawler/src/core/chrome/profile-resolver.ts`): `login` (port 9222, headed — log in to Instagram once), `public` (9223, headless — post capture), `flow` (9224, headed — Google Flow). The login profile refuses headless without `--force-headless`.
- Profile dirs (`data/chrome-profile-*`) are anchored to the package root through `import.meta.url`.
- Most capture commands return the standard envelope (`standard-output.ts`: `{ ok, schemaVersion, output: { profiles, posts }, meta }`); `discover-instagram` / `capture-instagram-profile` return simplified shapes. `avgLikes` is a dominant-cluster mean, not a plain average — see `packages/research-crawler/README.md` and `core/instagram/avg-likes.ts`.
- Progress streams to stderr via `ProgressReporter`; the backend passes `silentReporter()` so stdout JSON stays clean.

## TypeScript / module conventions

- All packages are ESM (`"type": "module"`). Shared compiler base: `tsconfig.base.json` (ES2022, `strict`, `isolatedModules`).
- Frontend path alias `@` → `packages/frontend/src` (in `vite.config.ts`).
- Electron main/preload are bundled by `vite-plugin-electron` with `electron`/`electron-updater` marked external.

## Release process

Releases are triggered by pushing a `v*` git tag. `.github/workflows/release.yml` runs `electron-builder --publish=always` on `windows-latest` and `macos-latest` **in parallel**, which creates **two duplicate draft releases per tag** (the mac+win race). To cut a release:

1. Make sure the working tree is clean and tests / typecheck are green.
2. Bump `version` in the **root `package.json`** (one-line edit; only that file is the source of truth — workspace packages don't carry independent versions for the release).
3. Commit: `chore(release): X.Y.Z` (match the existing style in `git log --grep "chore(release)"`).
4. Tag the commit `vX.Y.Z` and push both `main` and the tag.
5. After the workflow finishes (~3–4 min), two draft releases exist on the same tag. **Consolidate them manually**: pick one (typically the Windows one — it has the .exe most users want), upload the other's assets onto it via `gh release upload vX.Y.Z <files>`, publish the chosen draft (`gh api -X PATCH .../releases/<id> -f draft=false`), then delete the leftover draft. A v2.6.2 example lives in this session's transcript.

Do **not** edit version numbers anywhere else. `electron-builder.json` reads the version from root `package.json` (`directories.output: "release/${version}"` etc.).

## Packaging traps (read before adding a runtime dep)

`.npmrc` enables `node-linker=hoisted` + `shamefully-hoist=true`, but **electron-builder only packages third-party deps reachable from the root `package.json` `dependencies` graph**. A dep that lives only in `packages/<x>/package.json` is **invisible to the packager** even though pnpm has hoisted it for local dev.

Concretely: when you add a runtime `import` of a third-party module to any workspace package that runs **inside the packaged backend / agent / runtime**, you must also add the same package to the **root `package.json` `dependencies`**, otherwise the packaged app will crash at startup with `ERR_MODULE_NOT_FOUND`. This was the root cause of the 2.6.0 / 2.6.1 silent-launch regressions (`chokidar`, imported by `trigger-manager.ts`). The historical instance was `@xenova/transformers` + its native deps; the rule has bitten the project twice — assume it'll bite again.

Quick check before tagging a release:

```sh
# 1. Third-party imports actually reached in compiled output
grep -hoE "(import|from) ['\"][^'\".][^'\"]+['\"]" packages/backend/dist/*.js packages/conversation/dist/**/*.js packages/workflow-runtime/dist/*.js packages/ai-agent/dist/**/*.js \
  | grep -oE "['\"][^'\".][^'\"]+['\"]" | sort -u | grep -vE "^['\"]@anubis/|^['\"]\.|^['\"]node:"

# 2. Root deps
node -e "console.log(Object.keys(require('./package.json').dependencies).sort().join('\n'))"
```

Every name in (1) must appear in (2) (subpath imports like `hono/cors` resolve from the top-level `hono` entry). Native `.node` bindings (e.g. `better-sqlite3`, `node-pty`) are bundled by the `**/*.node` + `node_modules/**` rules in `electron-builder.json` `asarUnpack` — they need the same root-dep treatment.

## Debugging a packaged build that won't launch

The packaged app crash-on-startup symptom is "user double-clicks .exe, nothing visibly happens, no error". Two changes in 2.6.1 made this debuggable, **use them**:

1. `apps/desktop/electron/main/index.ts:134-141` — startup failure now opens a native `dialog.showErrorBox`. The message tells you what wrapper-level error fired (usually `Backend exited before it was ready. code=1 signal=null`), but **not the backend's actual stderr** — keep reading.
2. To get the backend's stderr, run the installed binary from PowerShell with stream capture:

   ```powershell
   & "$env:LOCALAPPDATA\Programs\Anubis\Anubis.exe" 2>&1 | Tee-Object -FilePath $env:TEMP\anubis-startup.log
   ```

   The main process forwards backend `stderr` chunks via `console.error(`[backend] ...`)` ([apps/desktop/electron/main/backend.ts:91-94](apps/desktop/electron/main/backend.ts:91)), so the real Node error (e.g. `ERR_MODULE_NOT_FOUND`) appears in the terminal.

If the click does nothing because an **existing instance** is alive but invisible (off-screen, hidden), the `second-instance` handler at [apps/desktop/electron/main/index.ts:152-174](apps/desktop/electron/main/index.ts:152) now recreates / shows / re-centers the window. Don't remove that recovery path.

If the NSIS installer complains "Anubis cannot be closed" while `tasklist` shows nothing, a stale Windows handle is holding the install dir. Fastest path: `Get-Process | Where-Object { $_.Path -like '*Anubis*' } | Stop-Process -Force`, or reboot.

## Auto-inject skills

`packages/ai-agent/skills/auto-inject/` is the canonical source for skills automatically loaded into every conversation. On every message send, [`writeProfileSkills`](packages/conversation/src/profiles/agent-home.ts:218) copies each active skill folder into `<conversation.workspacePath>/.agents/skills/<name>/`, replacing changed bodies and pruning stale dirs. `.agents/` is gitignored — never edit skills inside `.agents/`, edit the canonical source under `packages/ai-agent/skills/` and let the runtime sync them.
