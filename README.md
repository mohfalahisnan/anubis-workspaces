# Anubis

Anubis is an Electron desktop app for research crawling. The Electron main process
launches a local [Hono](https://hono.dev) HTTP backend as a child process, and the
React renderer talks to it over HTTP. The backend wraps `research-crawler`, a
CDP-driven (Chrome DevTools Protocol) browser-automation library that scrapes
Instagram and drives Google Flow.

Requires **Node.js >= 22** and **pnpm 10** (`pnpm@10.12.4`, see `packageManager`).

## Quick start

```sh
pnpm install
pnpm dev          # builds the crawler + Electron bundle and opens the desktop app
```

## Scripts

Run from the repo root:

| Command | Description |
| ------- | ----------- |
| `pnpm dev` | Full desktop dev loop (`scripts/dev.mjs`): Vite dev server + Electron + backend. |
| `pnpm build` | Build every package in order, then package with electron-builder. |
| `pnpm test` | Run Vitest unit tests. |
| `pnpm test:e2e` | Build the test bundle, then run Playwright end-to-end tests. |
| `pnpm typecheck` | Run `tsc --noEmit` across all packages. |

Package-scoped work:

```sh
pnpm --filter @anubis/backend dev:server     # run the backend alone
pnpm --filter research-crawler build         # build one package
pnpm --filter anubis-ai-agent build          # build the HTTP-oriented agent core
pnpm vitest run packages/research-crawler/tests/avg-likes.test.ts   # one test file
```

The build order is load-bearing: `research-crawler` → `anubis-ai-agent` →
`@anubis/backend` → `@anubis/frontend` → root `vite build`
(Electron main/preload) → `electron-builder`.

## Workspace layout

pnpm workspaces over `apps/*` and `packages/*`:

- **`apps/desktop`** — Electron main + preload. Compiles to `apps/desktop/dist-electron`.
- **`packages/frontend`** (`@anubis/frontend`) — React 19 + Vite + Tailwind v4 renderer with shadcn/ui and AI Elements components.
- **`packages/backend`** (`@anubis/backend`) — Hono server exposing `/health`, `/research-crawler/*`, and `/ai-agent/*`.
- **`packages/research-crawler`** (`research-crawler`) — internal CDP crawler library used by the backend; see [its README](packages/research-crawler/README.md).
- **`packages/anubis-ai-agent`** (`anubis-ai-agent`) — HTTP-oriented Codex/Claude agent core used by the backend; see [its README](packages/anubis-ai-agent/README.md).
- **`packages/shared`** (`@anubis/shared`) — types shared between frontend and backend.

## How it wires together

1. `scripts/dev.mjs` reserves a free port, starts the frontend Vite server, builds `research-crawler` and the Electron bundle, then launches Electron with `VITE_DEV_SERVER_URL` pointing at the renderer.
2. The Electron main process spawns the backend as a child process with `ANUBIS_BACKEND_PORT=0`, so the OS picks the port. In dev it runs the backend via `tsx`; when packaged it runs the compiled `server.js` with `ELECTRON_RUN_AS_NODE=1`.
3. The backend prints a `backend-ready` JSON line on stdout; the main process parses it to learn the URL.
4. The renderer gets the backend URL through the `anubis:get-backend-url` IPC channel, exposed as `window.anubis.backend.getBaseUrl()`. Outside Electron it falls back to `VITE_API_BASE_URL` or `http://127.0.0.1:3000`.

Because the port is dynamic, the renderer always resolves the backend URL through
`getApiBaseUrl()` rather than hardcoding it. The backend's CORS only allows localhost origins.

## Backend API

The Hono backend (`packages/backend/src`) validates request bodies with Zod and calls
internal packages directly:

- `GET /health`
- `POST /research-crawler/chrome/open`
- `POST /research-crawler/instagram/capture-profile`
- `POST /research-crawler/instagram/discover`
- `GET /ai-agent/catalog`
- `POST /ai-agent/run`

## License

MIT — see [LICENSE](LICENSE).
