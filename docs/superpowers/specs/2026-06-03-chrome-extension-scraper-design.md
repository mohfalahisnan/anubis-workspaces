# Chrome Extension Scraper — Design

**Date:** 2026-06-03
**Status:** Approved (brainstorming) — pending implementation plan
**Scope:** new `packages/extension`; new `packages/backend/src/extension/`; touches `packages/backend/src/{captures,research-crawler}.ts`; deletes the Chrome profile clone path; replaces the Settings profile picker.
**Context:** preceded by hand-off [`anubis-handoff-2026-06-03.md`](file:///C:/Users/User/AppData/Local/Temp/anubis-handoff-2026-06-03.md) and the failed cookie-clone attempt that culminated in commits `74d3bfe`/`6716ec5`/`ad0b52d` plus the in-flight clone code added today.

## Problem

The research-crawler launches its own Chrome via CDP. To capture an Instagram session the user has to be signed in inside that Chrome. Two attempts at reusing the user's existing daily-driver Chrome (Profile 3) failed:

1. **Direct launch against the user's `User Data\Profile 3`** triggers Chrome 136+'s mitigation that silently disables `--remote-debugging-port` whenever `--user-data-dir` matches Chrome's default location. Verified locally: launching against `C:\Users\User\AppData\Local\Google\Chrome\User Data` with `--remote-debugging-port=9222` produces no listener; launching against a fresh dir does. Mitigation is non-overridable.
2. **Cloning Profile 3 into an Anubis-owned user-data root** opens Chrome without CDP timeouts but doesn't carry the signed-in session. App-Bound Encryption on Chrome 127+ binds cookie-key decryption through an Elevator COM service that validates the calling binary and (in practice on 149) the user-data-dir path the cookies were minted in. Cookies copy across but don't decrypt; the user appears signed out.

A Chrome extension running inside the user's real, signed-in Chrome sidesteps both: it operates as the same process Chromium expects, with same-origin `fetch` against `instagram.com` carrying the live cookies. No CDP. No cookie copy. No ABE collision.

## Goals

1. Replace the login-profile CDP path with an in-Chrome extension that performs all logged-in Instagram scraping inside the user's real browser session.
2. Keep the existing UX shape: user clicks **Find competitors** / **Capture posts** in the Anubis desktop app, gets a normal HTTP response with the same data shapes as today.
3. Reuse the existing post-processing (avg-likes cluster mean, captured-post persistence, competitor stats updates). The extension returns raw `ProfileData` / `PostData`; backend orchestrates the rest.
4. Detect extension presence/absence instantly so the UI can route the user back to install/connect instructions.
5. Keep the existing CDP path alive for `profile=public` (anonymous IG capture works headlessly) and `profile=flow` (Google Flow).

## Non-goals

- Chrome Web Store distribution. v1 is unpacked / developer-mode sideload.
- Extension-initiated capture (button in extension popup). All triggers come from the Anubis app.
- A second extension for non-Chrome browsers.
- Bot-detection countermeasures beyond per-request jitter.
- Persistent job records. Jobs are in-memory; backend restart cancels them.
- Multi-Chrome support. One extension instance per backend.
- Encrypting the WS traffic. Loopback only; secret token is the only auth.

## Architecture

```
packages/extension/                ← NEW workspace package
├── manifest.json                    MV3, host_permissions for instagram.com + 127.0.0.1
├── src/
│   ├── background.ts                service worker: owns the WS, dispatches jobs, manages hidden tabs
│   ├── content/
│   │   ├── instagram.ts             content script: orchestrates page-side scraping per job kind
│   │   └── parsers.ts               pure functions: IG GraphQL/REST payload → ProfileData/PostData
│   ├── options/                     pairing UI (paste secret from Anubis Settings)
│   │   ├── index.html
│   │   └── index.tsx
│   └── popup/                       compact status pill ("Connected · idle" / "Capturing @user")
│       ├── index.html
│       └── index.tsx
├── vite.config.ts                   builds dist/ as a loadable unpacked extension
└── package.json

packages/backend/src/extension/    ← NEW backend module
├── ws-server.ts                     ws://127.0.0.1:47891/ext server, fallback 47891→47900
├── job-queue.ts                     in-memory job map + pending-promise router
├── schemas.ts                       Zod wire-protocol schemas
└── routes.ts                        GET /extension/status, POST /extension/secret/rotate

packages/backend/src/captures.ts          ← MODIFIED: login flow dispatches via ext, persists results unchanged
packages/backend/src/research-crawler.ts  ← MODIFIED: login discover/capture dispatches via ext
packages/backend/src/app.ts               ← MODIFIED: starts ws-server on stack init
packages/conversation/src/config/app-config.ts ← MODIFIED: + extensionSecret field
packages/shared/src/index.ts              ← MODIFIED: + ExtensionStatus, drop loginProfileDir + loginProfileSyncedAt
packages/frontend/src/pages/settings.tsx  ← MODIFIED: replace Chrome profile section with extension section
```

Three processes:

1. **Anubis Electron app** — UI, fires HTTP at backend, awaits results.
2. **Anubis backend (Hono + new WS server)** — owns the job queue, dispatches over WS, runs persistence + avg-likes on returned posts. Falls back to CDP for non-login profiles.
3. **User's Chrome with the extension installed** — service worker holds WS connection; on dispatch, opens a hidden minimized popup window to the target IG URL; content script scrapes; results travel back over WS.

## Wire protocol

WebSocket on `ws://127.0.0.1:47891/ext`. Backend tries 47891 first, scans to 47900 if taken; the bound port is persisted to `appConfig.extensionPort`.

**Extension-side port discovery.** The extension has no file-system access, so it discovers the port by attempting a WS connect on each candidate port in the range 47891–47900, in order. The first port that accepts the connection and responds to `hello` with a `welcome` (i.e. the secret validated) is recorded in `chrome.storage.local` and tried first on subsequent connects. On any later refusal it re-scans the range. This keeps the protocol stateless from the extension's POV — no out-of-band port hand-off needed.

**Handshake (first frames):**

```ts
// extension → backend
{ type: 'hello', secret: string, version: string }
// backend → extension on accept
{ type: 'welcome', backendVersion: string }
// backend → extension on bad secret, then close with WS code 4401
```

**Job dispatch + result:**

```ts
// backend → extension
{ type: 'dispatch',
  jobId: string,
  kind: 'capture-profile' | 'discover',
  input: CaptureProfileInput | DiscoverInput,
  timeoutMs: number }

{ type: 'cancel', jobId: string }

// extension → backend
{ type: 'progress', jobId: string, message: string }    // optional, for status pill
{ type: 'result',   jobId: string, ok: true,  data: { profiles: ProfileData[], posts: PostData[] } }
{ type: 'error',    jobId: string, ok: false, code: string, message: string }
```

Single-client model: backend accepts exactly one extension connection at a time. A second `hello` evicts the first (with a `replaced` close). This matches the single-user desktop app reality and avoids job-routing complexity.

**Liveness:**

- Backend sends WS ping every 25s. Missing two pongs → mark offline.
- MV3 service workers idle ~30s. Extension uses `chrome.alarms.create('keepalive', { periodInMinutes: 0.4 })` to wake before each ping and re-open the WS if dropped.
- Extension reconnect: exponential backoff 1s → 2s → 4s → max 30s, with jitter.

**Auth:**

- `appConfig.extensionSecret` — 32-byte cryptorandom hex, auto-generated by `AppConfigService` constructor when missing.
- Backend never logs the secret. Surfaced in Settings only on explicit "Reveal".
- `POST /extension/secret/rotate` re-generates; current WS is closed with `secret-rotated`; user re-pastes in extension Options.

## Job lifecycle

User clicks Find competitors:

1. Frontend: `POST /research-crawler/instagram/discover { profile: 'login', source: 'explore', targetCompetitors: 10 }`.
2. Backend route: `profile === 'login'` → call `jobQueue.dispatch({ kind: 'discover', input, timeoutMs: 60_000 })`.
3. `dispatch` creates `Job { id, kind, input, deadline }`, stores `pendingResolve(jobId)`, sends `{ type: 'dispatch', ... }` over WS. Returns the pending promise.
4. If no extension connected → reject immediately with `EXTENSION_OFFLINE`; route returns 503 + clear message.
5. Extension service worker receives `dispatch`. `chrome.windows.create({ url: 'https://www.instagram.com/explore/', type: 'popup', state: 'minimized', focused: false })`. Tracks window id by jobId.
6. Content script auto-injects on the IG origin (per manifest); on load it queries `chrome.runtime` for its assigned jobId+input, executes the kind-specific scrape, posts `chrome.runtime.sendMessage({ jobId, result })` → service worker → WS `result` frame.
7. Backend resolves the pending promise. HTTP route returns 200 with the data. Frontend renders unchanged.
8. Service worker closes the popup window after `result`/`error`/`cancel` or after a per-extension safety timeout (= job timeoutMs + 5s grace) even if backend never replied.
9. Errors map: `EXTENSION_ERROR` (extension reported a code), `EXTENSION_TIMEOUT` (no result within deadline), `EXTENSION_OFFLINE` (no connection at dispatch time). HTTP statuses 500 / 504 / 503.
10. Cancellation: frontend `AbortController` → backend marks job cancelled → sends `cancel` over WS → extension closes the popup. Pending promise rejects with `CANCELLED` (status 499).

Avg-likes calculation stays in the backend — it imports `dominantClusterMean` from `@anubis/research-crawler` (already a pure function) and runs it on the extension-returned posts.

## Scraping strategy

Content script runs in `https://www.instagram.com/*` with the user's live session. All requests are same-origin `fetch` — cookies, CSRF, `x-asbd-id`, `x-ig-app-id` headers carry automatically.

**`capture-profile`:**

1. Navigate hidden popup to `https://www.instagram.com/<username>/`.
2. Wait for `document.readyState === 'complete'` + a `MutationObserver`-detected presence of `main[role="main"]`.
3. Fetch `/api/v1/users/web_profile_info/?username=<username>` (returns `User` object with followers, post_count, biography, profile_pic).
4. Extract `user.id` (numeric).
5. Fetch `/api/v1/feed/user/<userId>/?count=<maxResponses>` for the post feed.
6. Map both payloads via `parsers.ts` → `{ profiles: ProfileData[], posts: PostData[] }`. Same shapes the CDP scraper produces today.

**`discover`:**

- `explore` → navigate to `/explore/`, watch for the GraphQL response containing `topic_results` (via injected `fetch` proxy on page script), dedupe by owner username.
- `hashtag` → navigate to `/explore/tags/<tag>/`, same GraphQL-interception strategy.
- `keyword` → call `/web/search/topsearch/?query=<q>` directly (returns users in flat JSON; no DOM scrape needed).

**Parser reuse:** the existing CDP scraper's payload parsers (the bits that turn IG's GraphQL/REST shapes into `ProfileData` / `PostData`) port verbatim into `packages/extension/src/content/parsers.ts`. The extension build can't import from `@anubis/research-crawler` (different runtime), so we duplicate — kept honest by sharing the input/output types from `@anubis/shared` and golden-file parser tests on both sides.

**Bot-detection mitigations:**

- One target URL per popup window per job; no rapid sequential navigation in the same tab.
- Multi-profile discover paces fetches with 800–1500ms jitter between profile lookups.
- All headers / cookies / user-agent are the user's real Chrome — indistinguishable from human browsing.

## Settings UX

The existing "Research-crawler · Chrome profile" section is replaced with:

```
┌─ Research-crawler · Chrome extension ──────────────────────────┐
│                                                                  │
│  ●  Connected — extension v0.1.0, paired 2 days ago             │
│                                                                  │
│  [ Reveal pairing secret ]   [ Re-generate secret ]              │
│                                                                  │
│  Install instructions:                                           │
│   1. Open chrome://extensions                                    │
│   2. Toggle "Developer mode" (top-right)                         │
│   3. Click "Load unpacked" → pick                                │
│      <ANUBIS_DATA_DIR>/extension/                                │
│   4. Click the Anubis icon → Options → paste the secret          │
│                                                                  │
│  [ Open extension folder ]   [ Copy install instructions ]       │
└──────────────────────────────────────────────────────────────────┘
```

- Status dot: green = connected, amber = offline, red = secret rotated and extension hasn't re-paired.
- "Open extension folder" calls an Electron-side IPC (`shell.openPath`) on `{ANUBIS_DATA_DIR}/extension/`.
- "Reveal pairing secret" toggles a monospace block; secret never appears in the DOM until clicked. Copy-to-clipboard via `navigator.clipboard.writeText`.
- "Re-generate secret" shows a confirm dialog, calls `POST /extension/secret/rotate`, replaces the displayed secret. Banner: "Re-paste into extension Options to reconnect."
- When the user clicks a login-requiring capture while the extension is offline, the toast says "Open Chrome with the Anubis extension to capture" with a "How?" link that routes to Settings.

Backend routes:

- `GET /extension/status` → `{ connected: boolean, extensionVersion?: string, pairedAt?: number, port: number, dataDirPath: string }`
- `POST /extension/secret/reveal` → `{ secret: string }` (returns the current; not stored in frontend state beyond display)
- `POST /extension/secret/rotate` → `{ secret: string }` (also returns; same UX as reveal)

## Distribution & install

**v1: unpacked, sideloaded.**

- Extension build output (`packages/extension/dist/`) is bundled into the Electron app's resources at packaging time.
- On backend startup, if `{ANUBIS_DATA_DIR}/extension/` is missing or `version.txt` differs from the bundled version, the backend copies the resources `extension/` directory there. The user's "Load unpacked" path stays stable.
- On Anubis update, backend re-copies. Chrome reloads unpacked extensions on browser startup; user doesn't manually refresh.
- Pairing survives reloads (secret persists in `chrome.storage.local`).

**Why not Web Store yet:**

- Single-user app, Web Store overhead not justified.
- Web Store enforces auto-update — surprising for power-user tools.
- Developer-mode banner is mildly annoying but acceptable.

**Future:** package as signed CRX3 with a self-hosted update manifest to suppress the banner.

## Schema changes

`packages/conversation/src/config/app-config.ts`:

```ts
export interface AppConfig {
  chromePath?: string
  // REMOVED: loginProfileDir, loginProfileSyncedAt
  // ADDED:
  extensionSecret?: string     // cryptorandom hex, auto-generated on first run
  extensionPort?: number       // bound WS port (47891–47900), persisted for the ext to find
  extensionPairedAt?: number   // epoch ms of the most recent successful hello
}
```

`AppConfigService` constructor auto-generates `extensionSecret` if missing. `extensionPort` written by `ws-server.ts` on bind.

`packages/shared/src/index.ts`:

```ts
export interface AppConfig { /* mirror of conversation/config */ }

export interface ExtensionStatus {
  connected: boolean
  extensionVersion?: string
  pairedAt?: number
  port: number
  dataDirPath: string
}
```

## Error shape on existing routes

`POST /captures/competitors/:id`, `POST /research-crawler/instagram/discover`, `POST /research-crawler/instagram/capture-profile` — when `profile === 'login'`:

- `EXTENSION_OFFLINE` → HTTP 503, `{ ok: false, error: { code, message, hint: 'Open Chrome with the Anubis extension to capture.' } }`
- `EXTENSION_TIMEOUT` → HTTP 504
- `EXTENSION_ERROR` → HTTP 500, with the extension's `code` + `message` bubbled in `error`
- `CANCELLED` → HTTP 499

Existing 412 `CLONE_REQUIRED` is removed along with the clone code.

## Files deleted

- `packages/backend/src/profile-clone.ts`
- `packages/backend/tests/profile-clone.test.ts`
- `packages/backend/src/chrome-guard.ts`
- `POST /system/chrome-profiles/clone` route in `packages/backend/src/system.ts`
- `splitProfilePath()` / `configOverrides()` / `withOverrides()` plumbing in `research-crawler.ts` and `captures.ts` — replaced with a single `dispatchToExtension(kind, input, timeoutMs)` helper
- Settings page's "Chrome profile" section + `cloneChromeProfile()` API helper
- `loginProfileDir` / `loginProfileSyncedAt` fields in `AppConfig` (both packages)

`--no-first-run` / `--no-default-browser-check` in `launch-chrome.ts` stay (cheap insurance for the surviving `public`/`flow` CDP paths).

## Migration notes

- The existing in-flight changes that added clone code (`profile-clone.ts`, clone test, Settings clone UI, `loginProfileSyncedAt`) are all undone in this work — they sit between the previous handoff's baseline and this design's net change. Net delta from the pre-clone baseline is +1500 / −500 lines (clone + new ext + new ws + new settings UI − old chrome-guard − old profile picker).
- `dominantClusterMean` stays exported from `@anubis/research-crawler` — no package reshuffle needed.
- `crawler-config-merge.test.ts` is rewritten as `crawler-extension-dispatch.test.ts`: same shape (one test per route), asserting that a login request dispatches a job with the expected `kind` + `input` and persists the mocked result.

## Testing

**Backend unit (vitest):**

- `ws-server.test.ts` — connect with valid/invalid secret; ping/pong; second `hello` evicts first; reconnect after drop; port fallback through 47891–47900.
- `job-queue.test.ts` — dispatch resolves on `result`; rejects on `error`; cancel sends `cancel` + rejects; timeout fires; offline dispatch rejects with `EXTENSION_OFFLINE` immediately.
- `crawler-extension-dispatch.test.ts` — `POST /captures/competitors/:id` with `profile: 'login'` dispatches a `capture-profile` job, persists returned posts via existing `CapturedPostsRepo`, calls `dominantClusterMean`. Mocks the WS bridge with a fake that replies with canned `ProfileData`/`PostData`.

**Extension unit (vitest, jsdom):**

- `parsers.test.ts` — golden-file fixtures of IG GraphQL/REST payloads (one per shape we care about) → expected `ProfileData` / `PostData[]`. These are the canary for IG response changes.
- `background.test.ts` — service worker state machine with mocked `chrome.*` APIs and a fake WS: connect → hello → dispatch → completion; reconnect after drop; popup window lifecycle.

**Manual end-to-end (no harness; the verification phase):**

1. Build, install extension via Load unpacked, paste secret → Settings shows "Connected".
2. Add a competitor, click Capture posts → real IG data returned, posts persisted, avg-likes computed.
3. Close Chrome → Settings shows "Offline"; Capture posts shows the friendly toast.
4. Reopen Chrome → "Connected" within ~2s.
5. Rotate secret → extension drops; pasting new secret reconnects.

## Open questions resolved during brainstorm

- Q: extension scope. A: full scraping in-page (the heaviest option, but cleanest).
- Q: trigger model. A: app-initiated only; extension has no triggers of its own.
- Q: wire protocol. A: WebSocket on fixed port with single-client model.
- Q: v1 coverage. A: extension owns logged-in IG; CDP remains for `public`/`flow`.

## Risks & mitigations

- **IG response-shape changes.** Parsers + golden-file tests; manual recovery when fixtures fail.
- **MV3 service worker death.** `chrome.alarms` keepalive, WS auto-reconnect.
- **Bot detection / rate limits.** Jitter between requests; one popup per job; no rapid sequential navigation. If IG flags the account, the user notices in their own Chrome and we have no special signal.
- **Port collision on 47891.** Fallback scan to 47900; backend writes the bound port to `appConfig.extensionPort` so the extension probes it.
- **Multiple Chrome installs / profiles.** Single-client WS model; first `hello` wins until evicted by a second. The user sideloads in whichever Chrome they want to scrape from.
- **Bundling friction.** Extension build is a normal Vite output; copying it into `{ANUBIS_DATA_DIR}/extension/` on startup mirrors how `agent-homes` is already handled.

## Implementation order (preview, plan will refine)

1. Wire protocol + ws-server + job-queue (backend, no extension yet — testable with a fake WS client).
2. AppConfig fields + secret generation + status route.
3. Extension package skeleton (manifest, build, options page) + pairing only.
4. End-to-end smoke: extension connects, backend dispatches a no-op job, extension echoes a fake result.
5. Content script + parsers for `capture-profile`.
6. Wire `POST /captures/competitors/:id` login flow → ext dispatch.
7. Content script for `discover` (all three sources).
8. Wire `POST /research-crawler/instagram/discover` login flow → ext dispatch.
9. Settings UI replacement + delete old clone code.
10. Bundle extension into Electron resources + first-run copy.
