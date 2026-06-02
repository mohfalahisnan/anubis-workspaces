# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Anubis is an Electron desktop app built as a pnpm monorepo. The Electron main process
spawns a local Hono HTTP backend as a child process; the React renderer talks to that
backend over HTTP. The backend wraps `research-crawler`, a CDP-driven (Chrome DevTools
Protocol) browser-automation library that scrapes Instagram and drives Google Flow.

> Note: `README.md` is the unmodified `electron-vite-react` template and does **not**
> describe this project's actual structure. Trust this file and `packages/research-crawler/README.md` instead.

## Workspace layout

pnpm workspaces (`pnpm-workspace.yaml`): `apps/*` and `packages/*`.

- `apps/desktop` — Electron main + preload (`electron/main`, `electron/preload`). Compiles to `apps/desktop/dist-electron`.
- `packages/frontend` (`@anubis/frontend`) — React 19 + Vite + Tailwind v4 renderer. shadcn/ui + AI Elements components. Builds to `packages/frontend/dist`.
- `packages/backend` (`@anubis/backend`) — Hono server exposing `/health` and `/research-crawler/*`.
- `packages/research-crawler` (`research-crawler`) — standalone crawler core (own version, own CLI, packable to a Node SEA binary). No HTTP/MCP server of its own.
- `packages/shared` (`@anubis/shared`) — types shared between frontend and backend (e.g. `ApiHealthResponse`).

Internal deps use `workspace:*`. Package imports inside `research-crawler` use explicit
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
pnpm --filter research-crawler build         # build one package
pnpm --filter @anubis/backend dev:server     # run backend alone (tsx, watch-free)
pnpm --filter research-crawler run pack:sea  # build standalone executable
```

Build order is load-bearing: `research-crawler` → `@anubis/backend` → `@anubis/frontend`
→ root `vite build` (electron main/preload) → `electron-builder`. `pretest` builds the
first three plus `vite build --mode=test` before tests run.

## How the desktop app wires together

1. `scripts/dev.mjs` reserves a free port, starts the frontend Vite server on it, builds `research-crawler` then the Electron bundle, then launches Electron with `VITE_DEV_SERVER_URL` pointing at the renderer.
2. `apps/desktop/electron/main/backend.ts` spawns the backend as a child process with `ANUBIS_BACKEND_PORT=0` (OS picks the port). In dev it runs `packages/backend/src/server.ts` via `tsx`; when packaged it runs `packages/backend/dist/server.js` with `ELECTRON_RUN_AS_NODE=1`.
3. The backend prints a JSON line `{"type":"backend-ready","url",...}` on stdout; the main process parses it to learn the URL (15s timeout).
4. The renderer gets the backend URL through the `anubis:get-backend-url` IPC channel, exposed via `contextBridge` as `window.anubis.backend.getBaseUrl()` (see `electron/preload/index.ts` and `packages/frontend/src/api.ts`). Outside Electron the frontend falls back to `VITE_API_BASE_URL` or `http://127.0.0.1:3000`.

Because the port is dynamic, never hardcode the backend URL in the renderer — always go
through `getApiBaseUrl()`. CORS on the backend only allows localhost origins.

## Backend ↔ crawler contract

`packages/backend/src/research-crawler.ts` validates request bodies with Zod and calls the
crawler library directly. Routes: `POST /research-crawler/chrome/open`,
`/instagram/capture-profile`, `/instagram/discover`. Backend errors are normalized in
`app.ts` (`ZodError` → 400 with issues, else 500).

## research-crawler specifics

- Talks to Chrome over CDP via a `--remote-debugging-port`. It does not bundle a browser; `open-chrome` (or `ensureFlowChrome`) launches/reuses a Chrome instance per profile.
- Three side-by-side Chrome profiles (`packages/research-crawler/src/core/chrome/profile-resolver.ts`): `login` (port 9222, headed — log in to Instagram once), `public` (9223, headless — post capture), `flow` (9224, headed — Google Flow). The login profile refuses headless without `--force-headless`.
- Profile dirs (`data/chrome-profile-*`) are anchored to the package root, computed differently for ESM vs the Node SEA bundle (`import.meta.url` is empty in the SEA build — see the comment in `profile-resolver.ts`).
- Most capture commands return the standard envelope (`standard-output.ts`: `{ ok, schemaVersion, output: { profiles, posts }, meta }`); `discover-instagram` / `capture-instagram-profile` return simplified shapes. `avgLikes` is a dominant-cluster mean, not a plain average — see `packages/research-crawler/README.md` and `core/instagram/avg-likes.ts`.
- Progress streams to stderr via `ProgressReporter`; the backend passes `silentReporter()` so stdout JSON stays clean.

## TypeScript / module conventions

- All packages are ESM (`"type": "module"`). Shared compiler base: `tsconfig.base.json` (ES2022, `strict`, `isolatedModules`).
- Frontend path alias `@` → `packages/frontend/src` (in `vite.config.ts`).
- Electron main/preload are bundled by `vite-plugin-electron` with `electron`/`electron-updater` marked external.
```
