# Research-Crawler Browser Manager — Design

**Date:** 2026-06-12
**Status:** Approved (design); pending spec review → writing-plans
**Scope:** `packages/research-crawler`

## Goal

Replace the per-call "open a Chrome profile → open a throwaway tab → do work →
close tab → kill Chrome" model with a structured, persistent browser-control
layer:

- A **Browser Manager** owns one Chrome process (one CDP socket, one tab registry).
- A **Tab Registry** tracks each live tab by `targetId` + `sessionId`.
- A **per-tab queue (mutex)** serialises commands on a single tab while allowing
  **different tabs to run in parallel** over one multiplexed socket.
- A uniform **command** surface (navigate / screenshot / extract DOM / click /
  type / close) that all CDP flows eventually share.

The driving outcome is faster crawling via multiple parallel tabs, on a single
structured remote-browser abstraction used uniformly by all CDP flows.

## Decisions (locked during brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Primary objective | One uniform Browser Manager + Tab Registry for **all** CDP flows; parallelism is the headline win. |
| 2 | CDP transport | **Single browser-level WebSocket per Chrome**, flat sessions: `Target.attachToTarget{flatten:true}` → one `sessionId` per tab, all commands/events multiplexed over the one socket and routed by `sessionId`. |
| 3 | Browser scope | **One `BrowserManager` per Chrome process**, behind a `BrowserRegistry` keyed by profile (login/public/flow). One manager == one browser, matching the architecture diagram. |
| 4 | Process lifecycle | `BrowserManager` **owns full lifecycle**: reuse-or-spawn Chrome (wrapping today's `launchChrome`), hold the socket + tab registry, `close({kill})` to kill or detach. `launchChrome`/`killChrome` become internal primitives. |
| 5 | Rollout | **Layer + Instagram pilot first.** Build the layer, migrate Instagram capture + discover as the vertical slice, keep ChatGPT/Qwen/Flow working via a compatibility adapter; migrate them in follow-up plans. |
| a | ChatGPT/Qwen/Flow | Reimplement `withCdpCaptureSession` as a **thin adapter over `BrowserManager`** so they run on the single-socket transport unchanged at the call site. |
| b | Default concurrency cap | **4** concurrent active tabs per browser, configurable per call. Conservative because parallel tabs share one Instagram session/cookies. |
| c | `screenshot` command | **Included** in the v1 command surface (the diagram lists it) but has **no current consumer** — implemented thin, not load-bearing for the pilot. |

## Architecture

```
BrowserRegistry              singleton: profile → BrowserManager (cached, reused)
  └─ BrowserManager          one per Chrome process / profile
       ├─ CdpConnection      ONE browser-level WebSocket, multiplexed
       ├─ TabRegistry        tabId → { targetId, sessionId, url, state, queue }
       ├─ Semaphore          caps concurrent active tabs (default 4)
       └─ Tab handles        returned to consumers
            └─ CommandQueue   per-tab FIFO mutex
                 └─ commands  navigate / screenshot / extractDom / click / type / close
```

### Proposed file layout

```
packages/research-crawler/src/core/browser/
  cdp-connection.ts          # multiplexed browser-level socket (evolves cdp-session.ts)
  browser-manager.ts         # per-process lifecycle + tabs + socket
  browser-registry.ts        # profile → manager cache + shutdown
  tab.ts                     # Tab handle + command methods
  tab-registry.ts            # tabId → { targetId, sessionId, queue, state }
  command-queue.ts           # per-tab FIFO mutex
  semaphore.ts               # concurrency cap primitive
  legacy-session-adapter.ts  # builds the old { send, on, close } CdpSession over connection+sessionId
```

- `launch-chrome.ts` — **kept**, now an internal primitive of `BrowserManager`.
- `chrome-connector.ts` — keep `listChromeTargets` + `resolve*Target` predicates
  (reused by `attachExisting`). `openChromeTab`/`closeChromeTab` fold into
  `BrowserManager` via `Target.createTarget`/`Target.closeTarget` on the shared socket.
- `cdp-capture-session.ts` — `withCdpCaptureSession` reimplemented as the adapter
  (see Compatibility).
- `cdp-session.ts` — evolves into `cdp-connection.ts` (or kept as a low-level
  single-socket helper that `cdp-connection.ts` builds on).

## Components

### CdpConnection
One WebSocket to the browser-level `webSocketDebuggerUrl` (from `/json/version`).

- `send<T>(method, params?, sessionId?)` — multiplexes by message `id`; resolves
  the matching pending promise. `sessionId` omitted ⇒ browser-level command.
- `on(method, handler, sessionId?)` — subscribe to **session-scoped** events.
  The connection demuxes incoming messages by their top-level `sessionId` so each
  tab only receives its own events. **This is required for Instagram capture,
  which listens to `Network.*` events that are session-scoped under flat mode.**
- On socket close: reject all pending, emit a `closed` signal so the manager can
  evict itself from the registry.
- Keeps the existing **injectable `WebSocketConstructor`** seam for tests.

### BrowserManager (one per Chrome process)
- `launch()` — reuse-or-spawn Chrome via `launchChrome`, open `CdpConnection`,
  enable target discovery / auto-attach (`Target.setDiscoverTargets`,
  `Target.setAutoAttach{flatten:true}` as appropriate).
- `newTab(url)` — `Target.createTarget` → `attachToTarget{flatten:true}` →
  register `{ targetId, sessionId }` in `TabRegistry` → return a `Tab`.
- `attachExisting(predicate)` — find an existing target (e.g. the logged-in IG
  tab) via `listChromeTargets` + a `resolve*` predicate → attach → register.
- `withTab(opts, fn)` — acquire (via Semaphore) → `newTab`/`attachExisting` →
  run `fn(tab)` → release + close/keep tab per opts. Replaces the
  open/finally-close scaffolding of `withCdpCaptureSession`.
- `close({ kill })` — close the socket; `kill: true` also `killChrome`.

### TabRegistry
`Map<tabId, TabRecord>` — single source of truth for live tabs and their
`targetId/sessionId`. `add` / `get` / `remove` / `list`. Removes a tab on
`Target.detachedFromTarget` / `Target.targetDestroyed`.

### Tab (handle)
Wraps `tabId/targetId/sessionId` + a `CommandQueue`. Every command method routes
through the queue and calls `connection.send(method, params, sessionId)`:

- `navigate(url, opts?)`
- `screenshot(opts?)`  *(v1, no current consumer)*
- `extractDom()` / `evaluate(expr)`
- `click(selector)` / `type(selector, text)`
- `waitFor(predicate|selector, timeout)`
- `on(method, handler)` — session-scoped event subscription (passthrough to connection)
- `close()`

Commands are plain typed methods over a small CDP primitive set — **not** an
over-engineered command-object registry (YAGNI).

### CommandQueue (per-tab mutex)
A promise chain. `enqueue(fn) => Promise<T>` guarantees one command at a time per
tab; a thrown command rejects only its own promise and the queue continues with
the next. Per-command timeout (configurable) so a hung command can't wedge the tab.

### Semaphore
Caps concurrent active tabs per browser (default 4). `acquire()/release()`.

### BrowserRegistry
Top-level cache: `get(profile, opts) => BrowserManager`, creating + memoising one
manager per profile so concurrent crawl calls share one socket and browser.
Evicts a manager when its connection closes. Provides a `closeAll()` for app
shutdown.

## Parallelism model

- **Per tab:** serialized by `CommandQueue` (navigate-then-scrape stays correct).
- **Across tabs:** independent queues and command `id`s over the one socket ⇒
  interleave freely.
- **Consumers fan out** with a bounded pool:
  `Promise.all(items.map(i => manager.withTab(opts, t => work(i, t))))`,
  the Semaphore enforcing the cap.
- **Risk:** parallel tabs on the `login` profile share one Instagram
  session/cookies; excessive concurrency invites rate-limiting/detection. The cap
  defaults to 4 and is configurable per call.

## Migration & compatibility

- **Single transport everywhere.** `withCdpCaptureSession(opts, body)` is
  reimplemented as a thin adapter: acquire a tab via `BrowserManager`, build a
  legacy `CdpSession` (`{ send, on, close }`) bound to that tab's `sessionId` via
  `legacy-session-adapter.ts`, run `body`, close/keep per opts. **ChatGPT, Qwen,
  and Flow code is untouched** but immediately runs on the single-socket model.
- **Instagram pilot (vertical slice):**
  - Rewrite `instagram-cdp-capture.service.ts` to consume `manager.withTab(...)`
    directly (new ergonomic API + session-scoped `Network.*` events).
  - `captureInstagramData` fans out across competitors, bounded by the Semaphore.
  - `discoverInstagramCompetitors` likewise.
- **Contracts unchanged:** backend routes, the standard envelope
  (`{ ok, schemaVersion, output, meta }`), `avgLikes`, progress reporting.
  `keepChromeOpen`/`keepTabOpen` map onto `close({ kill })` / leaving the tab
  registered.

## Error handling

- **Socket drop** → reject all pending, mark manager dead, registry evicts it;
  next `get()` relaunches.
- **Tab crash** (`detachedFromTarget`/`targetDestroyed`) → registry removes the
  tab; its queue rejects pending with a clear message.
- **Per-command timeout** (configurable) so a hung command can't wedge a tab.
- **`launchChrome` failures** bubble as today (port-in-use mismatch, spawn
  failure, port-not-open-within-10s).
- **Queue error isolation:** one failed command does not poison subsequent
  commands on the same tab.

## Testing

The WebSocket constructor and `fetch` are already injectable — reuse those seams.

- `CdpConnection`: `sessionId` routing, `id`/pending resolution, **event demux by
  session**, socket-close rejection (fake WebSocket).
- `CommandQueue`: ordering/serialization, mutual exclusion, error isolation,
  timeout.
- `TabRegistry`: add/get/remove/list; removal on detach/destroy events.
- `Semaphore`: cap enforcement (no more than N concurrent acquisitions).
- `BrowserManager`: `newTab`/`attachExisting` with injected connection + fake
  `fetch` (`listChromeTargets`).
- **Regression:** existing ChatGPT/Qwen tests pass through the new
  `withCdpCaptureSession` adapter unchanged.
- **Instagram:** capture service tests re-pointed at `BrowserManager` using
  existing fixtures; `avg-likes` and standard-output tests untouched.

## Out of scope (follow-up plans)

- Migrating ChatGPT/Qwen/Flow off the legacy adapter onto the native `Tab` API.
- Any new backend routes or frontend changes (this is an internal library refactor;
  HTTP contracts are preserved).
- A general parallel-capture endpoint/UI — the library gains the capability; wiring
  a batch route is a separate plan.
