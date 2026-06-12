# Research-Crawler Browser Manager — Implementation Plan (Phase 2: Wiring + Launch Lifecycle)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the Instagram-capture, ChatGPT, and Qwen flows over the Phase 1 `BrowserManager` (single multiplexed CDP socket) by reimplementing `withCdpCaptureSession` on top of it, give `BrowserManager` full process lifecycle (`launch()` reuse-or-spawn + `close({ kill })`), and add the two deferred robustness items (per-command timeout, event-driven tab eviction) — all behavior-preserving.

**Architecture:** `withCdpCaptureSession` keeps its exact result contract, but its body now acquires a `Tab` from a registry-cached `BrowserManager` (shared per Chrome origin) and hands the caller a legacy `CdpSession` built by `createLegacySession`. The per-tab `connectSession` injection seam is replaced by a single `getManager` seam (default = process-wide `browserRegistry`). The three existing service tests reuse their current mock sessions verbatim through a `fakeGetManager(session)` test helper. Flow, Instagram discovery, and login-detector are out of scope and stay on the legacy per-tab `connectCdpSession` path (they open their own socket to the same Chrome — no conflict).

**Tech Stack:** TypeScript (ESM, explicit `.js` import extensions), Node ≥ 22, `node:test` + `node:assert/strict` (run via `node --import tsx --test`). No new third-party runtime deps.

**Prerequisite:** Phase 1 merged (the `src/core/browser/` layer exists and is exported). Reference spec: `docs/superpowers/specs/2026-06-12-research-crawler-browser-manager-design.md`.

**Scope boundary (Phase 3, NOT here):** Instagram native `Tab` rewrite; consumer-level parallel batch fan-out across competitors; migrating Flow / Instagram discovery / login-detector off `connectCdpSession`. Those three are unaffected by this plan.

**Conventions (every task):**
- Work from `packages/research-crawler/`. Run a test file with `node --import tsx --test <path>`.
- Explicit `.js` extensions on relative imports.
- After the last task: `pnpm --filter @anubis/research-crawler typecheck` must pass, and the full research-crawler suite must be green.

---

## File Structure

```
packages/research-crawler/src/core/browser/
  tab.ts                     # MODIFY — add per-command timeout to send()
  browser-manager.ts         # MODIFY — add attach(target), event-driven eviction, timeout plumbing
  browser-lifecycle.ts       # CREATE — launchBrowserManager() reuse-or-spawn + closeBrowserManager({kill})
packages/research-crawler/src/core/chrome/
  cdp-capture-session.ts     # MODIFY — reimplement withCdpCaptureSession over BrowserManager (same contract)
packages/research-crawler/src/core/services/
  instagram-cdp-capture.service.ts  # MODIFY — swap connectSession seam → getManager
  chatgpt-cdp-capture.service.ts    # MODIFY — swap connectSession seam → getManager
  qwen-cdp-capture.service.ts       # MODIFY — swap connectSession seam → getManager
packages/research-crawler/tests/browser/
  fake-browser.ts            # CREATE — shared test helper (wraps a mock session in a manager)
  browser-manager-attach.test.ts    # CREATE
  browser-eviction.test.ts          # CREATE
  tab-timeout.test.ts               # CREATE
  browser-lifecycle.test.ts         # CREATE
  cdp-capture-session.test.ts       # CREATE — wrapper contract over BrowserManager
packages/research-crawler/tests/
  instagram-cdp-capture.service.test.ts  # MODIFY — re-point to getManager seam
  chatgpt-cdp-capture.service.test.ts    # MODIFY — re-point to getManager seam
  qwen-cdp-capture.service.test.ts       # MODIFY — re-point to getManager seam
packages/research-crawler/src/index.ts   # MODIFY — export launchBrowserManager/closeBrowserManager
```

---

## Task 1: BrowserManager.attach(target) — attach by a known target

`withCdpCaptureSession`'s reuse path already resolves a `ChromeTarget` (URL matching + polling) via `resolveTarget`. The manager needs to attach to that exact target by id, distinct from `attachExisting(predicate)` which does its own listing.

**Files:**
- Modify: `packages/research-crawler/src/core/browser/browser-manager.ts`
- Create: `packages/research-crawler/tests/browser/browser-manager-attach.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/research-crawler/tests/browser/browser-manager-attach.test.ts`:

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBrowserManager } from '../../src/core/browser/browser-manager.js'
import type { CdpConnection, CdpEventHandler } from '../../src/core/browser/cdp-connection.js'

function fakeFetch() {
  return (async (input: unknown) => {
    const url = new URL(String(input))
    if (url.pathname === '/json/version') return { ok: true, json: async () => ({ webSocketDebuggerUrl: 'ws://browser' }) } as unknown as Response
    throw new Error(`unexpected fetch ${url.pathname}`)
  }) as unknown as typeof fetch
}

function scriptedConnection(onSend?: (m: string, p: unknown) => void) {
  let sessionSeq = 0
  const connection: CdpConnection = {
    async send(method, params) {
      onSend?.(method, params)
      if (method === 'Target.attachToTarget') return { sessionId: `S${++sessionSeq}` } as never
      return {} as never
    },
    on(_m: string, _h: CdpEventHandler) { return () => {} },
    onClose() {}, isOpen() { return true }, close() {},
  }
  return connection
}

test('attach() attaches to the given target id and registers it', async () => {
  const sent: Array<{ m: string; p: any }> = []
  const manager = await createBrowserManager({
    chromeOrigin: 'http://127.0.0.1:9222',
    fetchImpl: fakeFetch(),
    connect: async () => scriptedConnection((m, p) => sent.push({ m, p })),
  })
  const tab = await manager.attach({ id: 'TZ', type: 'page', url: 'https://www.instagram.com/', webSocketDebuggerUrl: 'ws://z' })
  assert.equal(tab.targetId, 'TZ')
  assert.equal(tab.sessionId, 'S1')
  assert.equal(manager.listTabs()[0]!.url, 'https://www.instagram.com/')
  const attachCall = sent.find((s) => s.m === 'Target.attachToTarget')
  assert.equal(attachCall!.p.targetId, 'TZ')
  assert.equal(attachCall!.p.flatten, true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/browser/browser-manager-attach.test.ts`
Expected: FAIL — `manager.attach is not a function`.

- [ ] **Step 3: Implement `attach`**

In `packages/research-crawler/src/core/browser/browser-manager.ts`, add `attach` to the `BrowserManager` type immediately after the `attachExisting(...)` line:

```ts
  attach(target: ChromeTarget): Promise<Tab>
```

And add the method to the returned `manager` object, immediately after the `attachExisting` method:

```ts
    async attach(target) {
      const sessionId = await attachTo(target.id)
      return register(target.id, sessionId, target.url)
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/browser/browser-manager-attach.test.ts`
Expected: PASS — 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add packages/research-crawler/src/core/browser/browser-manager.ts packages/research-crawler/tests/browser/browser-manager-attach.test.ts
git commit -m "feat(research-crawler): BrowserManager.attach(target) by known target id"
```

---

## Task 2: Event-driven tab eviction

When a tab crashes or is closed externally, Chrome emits `Target.detachedFromTarget` (carries `sessionId`) and `Target.targetDestroyed` (carries `targetId`). The manager must drop the tab from the registry so it can't be reused.

**Files:**
- Modify: `packages/research-crawler/src/core/browser/browser-manager.ts`
- Create: `packages/research-crawler/tests/browser/browser-eviction.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/research-crawler/tests/browser/browser-eviction.test.ts`:

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBrowserManager } from '../../src/core/browser/browser-manager.js'
import type { CdpConnection, CdpEventHandler } from '../../src/core/browser/cdp-connection.js'

function fakeFetch() {
  return (async (input: unknown) => {
    const url = new URL(String(input))
    if (url.pathname === '/json/version') return { ok: true, json: async () => ({ webSocketDebuggerUrl: 'ws://browser' }) } as unknown as Response
    throw new Error(`unexpected fetch ${url.pathname}`)
  }) as unknown as typeof fetch
}

/** Connection that lets the test emit browser-level events (no sessionId). */
function eventConnection() {
  let targetSeq = 0
  let sessionSeq = 0
  const browserHandlers: Array<{ method: string; handler: CdpEventHandler }> = []
  const connection: CdpConnection = {
    async send(method) {
      if (method === 'Target.createTarget') return { targetId: `T${++targetSeq}` } as never
      if (method === 'Target.attachToTarget') return { sessionId: `S${++sessionSeq}` } as never
      return {} as never
    },
    on(method, handler, sessionId) {
      if (!sessionId) browserHandlers.push({ method, handler })
      return () => {}
    },
    onClose() {}, isOpen() { return true }, close() {},
  }
  const emit = (method: string, params: unknown) => {
    for (const h of browserHandlers) if (h.method === method) void h.handler(params)
  }
  return { connection, emit }
}

test('targetDestroyed evicts the tab from the registry', async () => {
  const ev = eventConnection()
  const manager = await createBrowserManager({
    chromeOrigin: 'http://127.0.0.1:9222', fetchImpl: fakeFetch(), connect: async () => ev.connection,
  })
  const tab = await manager.newTab('https://example.com/')
  assert.equal(manager.listTabs().length, 1)
  ev.emit('Target.targetDestroyed', { targetId: tab.targetId })
  assert.equal(manager.listTabs().length, 0)
})

test('detachedFromTarget evicts the tab by sessionId', async () => {
  const ev = eventConnection()
  const manager = await createBrowserManager({
    chromeOrigin: 'http://127.0.0.1:9222', fetchImpl: fakeFetch(), connect: async () => ev.connection,
  })
  const tab = await manager.newTab('https://example.com/')
  ev.emit('Target.detachedFromTarget', { sessionId: tab.sessionId })
  assert.equal(manager.listTabs().length, 0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/browser/browser-eviction.test.ts`
Expected: FAIL — registry still lists 1 tab after the event.

- [ ] **Step 3: Subscribe to detach/destroy in `createBrowserManager`**

In `packages/research-crawler/src/core/browser/browser-manager.ts`, immediately after `const connection = await connect(browserWsUrl)`, add:

```ts
  connection.on('Target.targetDestroyed', (params) => {
    const targetId = (params as { targetId?: string })?.targetId
    if (!targetId) return
    const record = registry.getByTargetId(targetId)
    if (record) registry.remove(record.tabId)
  })
  connection.on('Target.detachedFromTarget', (params) => {
    const sessionId = (params as { sessionId?: string })?.sessionId
    if (!sessionId) return
    const record = registry.getBySessionId(sessionId)
    if (record) registry.remove(record.tabId)
  })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/browser/browser-eviction.test.ts`
Expected: PASS — 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/research-crawler/src/core/browser/browser-manager.ts packages/research-crawler/tests/browser/browser-eviction.test.ts
git commit -m "feat(research-crawler): evict tabs on Target detached/destroyed events"
```

---

## Task 3: Per-command timeout on Tab.send

A hung CDP command must auto-reject so it can't wedge a tab's queue forever. Add an optional `commandTimeoutMs` to the tab (plumbed from the manager); `0`/undefined means no timeout (default — preserves current behavior).

**Files:**
- Modify: `packages/research-crawler/src/core/browser/tab.ts`
- Modify: `packages/research-crawler/src/core/browser/browser-manager.ts`
- Create: `packages/research-crawler/tests/browser/tab-timeout.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/research-crawler/tests/browser/tab-timeout.test.ts`:

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTab } from '../../src/core/browser/tab.js'
import { createCommandQueue } from '../../src/core/browser/command-queue.js'
import type { TabRecord } from '../../src/core/browser/tab-registry.js'
import type { CdpConnection } from '../../src/core/browser/cdp-connection.js'

const record = (): TabRecord => ({
  tabId: 'tab-1', targetId: 'T1', sessionId: 'S1', url: 'https://x/', state: 'open', queue: createCommandQueue(),
})

function hangingConnection(): CdpConnection {
  return {
    send() { return new Promise(() => {}) }, // never resolves
    on() { return () => {} }, onClose() {}, isOpen() { return true }, close() {},
  }
}

test('send rejects after commandTimeoutMs when the command hangs', async () => {
  const tab = createTab({ record: record(), connection: hangingConnection(), onClose: async () => {}, commandTimeoutMs: 20 })
  await assert.rejects(tab.send('Runtime.evaluate', { expression: '1' }), /timed out/i)
})

test('no timeout when commandTimeoutMs is omitted (resolves normally)', async () => {
  const connection: CdpConnection = {
    async send() { return { ok: true } as never },
    on() { return () => {} }, onClose() {}, isOpen() { return true }, close() {},
  }
  const tab = createTab({ record: record(), connection, onClose: async () => {} })
  assert.deepEqual(await tab.send('X'), { ok: true })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/browser/tab-timeout.test.ts`
Expected: FAIL — `commandTimeoutMs` not accepted; the hanging send never rejects.

- [ ] **Step 3: Add the timeout to `createTab`**

In `packages/research-crawler/src/core/browser/tab.ts`, extend `CreateTabArgs`:

```ts
export type CreateTabArgs = {
  record: TabRecord
  connection: CdpConnection
  /** Closes the underlying target and removes the tab from the registry. */
  onClose: (tabId: string) => Promise<void>
  /** Reject a single CDP command after this many ms (0/undefined = no timeout). */
  commandTimeoutMs?: number
}
```

Change the `createTab` signature line to destructure it, and replace the `send` definition:

```ts
export function createTab({ record, connection, onClose, commandTimeoutMs }: CreateTabArgs): Tab {
  const send = <T = unknown>(method: string, params: Record<string, unknown> = {}) =>
    record.queue.run(() => withTimeout(connection.send<T>(method, params, record.sessionId), commandTimeoutMs, method))
```

Add this helper at the bottom of the file (after `createTab`):

```ts
function withTimeout<T>(promise: Promise<T>, ms: number | undefined, label: string): Promise<T> {
  if (!ms || ms <= 0) return promise
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`CDP command timed out after ${ms}ms: ${label}`)), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}
```

- [ ] **Step 4: Plumb the option through the manager**

In `packages/research-crawler/src/core/browser/browser-manager.ts`, add to `BrowserManagerOptions`:

```ts
  /** Per-command timeout for tabs created by this manager (ms; 0/undefined = none). */
  commandTimeoutMs?: number
```

In `register`, pass it into `createTab`:

```ts
    return createTab({ record, connection, onClose, commandTimeoutMs: options.commandTimeoutMs })
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --import tsx --test tests/browser/tab-timeout.test.ts`
Expected: PASS — 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/research-crawler/src/core/browser/tab.ts packages/research-crawler/src/core/browser/browser-manager.ts packages/research-crawler/tests/browser/tab-timeout.test.ts
git commit -m "feat(research-crawler): per-command timeout on Tab.send"
```

---

## Task 4: Launch lifecycle (`launchBrowserManager` + `closeBrowserManager`)

Give the manager ownership of the Chrome process: reuse-or-spawn via the existing `launchChrome`, then attach a `BrowserManager`; close it (optionally killing Chrome) via the existing `killChrome`.

**Files:**
- Create: `packages/research-crawler/src/core/browser/browser-lifecycle.ts`
- Create: `packages/research-crawler/tests/browser/browser-lifecycle.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/research-crawler/tests/browser/browser-lifecycle.test.ts`:

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { launchBrowserManager, closeBrowserManager } from '../../src/core/browser/browser-lifecycle.js'
import type { CdpConnection, CdpEventHandler } from '../../src/core/browser/cdp-connection.js'

function fakeFetch() {
  return (async (input: unknown) => {
    const url = new URL(String(input))
    if (url.pathname === '/json/version') return { ok: true, json: async () => ({ webSocketDebuggerUrl: 'ws://browser' }) } as unknown as Response
    if (url.pathname === '/json/list') return { ok: true, json: async () => [] } as unknown as Response
    throw new Error(`unexpected fetch ${url.pathname}`)
  }) as unknown as typeof fetch
}

function fakeConnection(): CdpConnection {
  let open = true
  return {
    async send() { return {} as never },
    on(_m: string, _h: CdpEventHandler) { return () => {} },
    onClose() {}, isOpen() { return open }, close() { open = false },
  }
}

test('launchBrowserManager launches Chrome then attaches a manager at its origin', async () => {
  const launched: Array<Record<string, unknown>> = []
  const manager = await launchBrowserManager({
    profile: 'public',
    fetchImpl: fakeFetch(),
    connect: async () => fakeConnection(),
    launchChromeImpl: async (input) => {
      launched.push(input)
      return { ok: true, pid: 1, reused: false, remoteDebuggingPort: 9223, profile: 'public', profileDir: 'd', url: 'u', headless: true, warnings: [] }
    },
  })
  assert.equal(manager.chromeOrigin, 'http://127.0.0.1:9223/')
  assert.equal(launched.length, 1)
  assert.equal(launched[0]!.profile, 'public')
})

test('closeBrowserManager closes the manager and kills Chrome when kill=true', async () => {
  let killedPort = 0
  const manager = await launchBrowserManager({
    profile: 'public',
    fetchImpl: fakeFetch(),
    connect: async () => fakeConnection(),
    launchChromeImpl: async () => ({ ok: true, pid: 1, reused: false, remoteDebuggingPort: 9223, profile: 'public', profileDir: 'd', url: 'u', headless: true, warnings: [] }),
  })
  await closeBrowserManager(manager, { kill: true, port: 9223, killChromeImpl: async (p) => { killedPort = p } })
  assert.equal(manager.isOpen(), false)
  assert.equal(killedPort, 9223)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/browser/browser-lifecycle.test.ts`
Expected: FAIL — cannot find module `browser-lifecycle.js`.

- [ ] **Step 3: Implement the lifecycle module**

Create `packages/research-crawler/src/core/browser/browser-lifecycle.ts`:

```ts
import { createBrowserManager, type BrowserManager, type ConnectFn } from './browser-manager.js'
import { launchChrome, killChrome, type LaunchChromeInput, type LaunchChromeResult } from '../chrome/launch-chrome.js'

export type LaunchBrowserManagerOptions = LaunchChromeInput & {
  fetchImpl?: typeof fetch
  connect?: ConnectFn
  maxConcurrentTabs?: number
  commandTimeoutMs?: number
  /** Injectable for tests. */
  launchChromeImpl?: (input: LaunchChromeInput) => Promise<LaunchChromeResult>
}

/** Reuse-or-spawn Chrome via launchChrome, then attach a BrowserManager at its origin. */
export async function launchBrowserManager(options: LaunchBrowserManagerOptions): Promise<BrowserManager> {
  const launch = options.launchChromeImpl ?? launchChrome
  const { fetchImpl, connect, maxConcurrentTabs, commandTimeoutMs, launchChromeImpl, ...launchInput } = options
  const result = await launch(launchInput)
  const chromeOrigin = `http://127.0.0.1:${result.remoteDebuggingPort}`
  return createBrowserManager({
    chromeOrigin,
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(connect ? { connect } : {}),
    ...(maxConcurrentTabs !== undefined ? { maxConcurrentTabs } : {}),
    ...(commandTimeoutMs !== undefined ? { commandTimeoutMs } : {}),
  })
}

export type CloseBrowserManagerOptions = {
  kill?: boolean
  /** Required when kill is true: the port whose Chrome to kill. */
  port?: number
  /** Injectable for tests. */
  killChromeImpl?: (port: number) => Promise<void>
}

/** Close the manager's socket (and its tabs); optionally kill the Chrome process. */
export async function closeBrowserManager(manager: BrowserManager, options: CloseBrowserManagerOptions = {}): Promise<void> {
  await manager.close()
  if (options.kill && typeof options.port === 'number') {
    const kill = options.killChromeImpl ?? killChrome
    await kill(options.port)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test tests/browser/browser-lifecycle.test.ts`
Expected: PASS — 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/research-crawler/src/core/browser/browser-lifecycle.ts packages/research-crawler/tests/browser/browser-lifecycle.test.ts
git commit -m "feat(research-crawler): launch/close BrowserManager lifecycle over launchChrome"
```

---

## Task 5: Shared test helper + reimplement `withCdpCaptureSession` over BrowserManager

This is the core wiring. `withCdpCaptureSession` keeps its result contract, but: (a) the per-tab `connectSession` option is replaced by a `getManager` option (default = process-wide `browserRegistry`), and (b) the body now receives a `session` produced by `createLegacySession(tab)`.

First a shared test helper that wraps any legacy mock session in a manager — so the service tests (Tasks 6–8) keep their existing mock sessions unchanged.

**Files:**
- Create: `packages/research-crawler/tests/browser/fake-browser.ts`
- Modify: `packages/research-crawler/src/core/chrome/cdp-capture-session.ts`
- Create: `packages/research-crawler/tests/browser/cdp-capture-session.test.ts`

- [ ] **Step 1: Write the shared test helper**

Create `packages/research-crawler/tests/browser/fake-browser.ts`:

```ts
import { createBrowserManager, type BrowserManager } from '../../src/core/browser/browser-manager.js'
import type { CdpConnection, CdpEventHandler } from '../../src/core/browser/cdp-connection.js'

/** The subset of the legacy CdpSession a mock provides. */
export type SessionLike = {
  send(method: string, params?: any): Promise<any>
  on(method: string, handler: (params: unknown) => void): void
  close?(): void
}

const inertSession: SessionLike = { async send() { return {} }, on() {} }

/**
 * Fake multiplexed CdpConnection that handles Target.* itself (so newTab/attach
 * work) and forwards every other command/subscription to a legacy-style mock
 * session. Mocks that drive their own Network.* events via stored listeners keep
 * working unchanged: their on() registers the handler and their
 * send('Network.enable') fires it.
 */
export function fakeBrowserConnection(session: SessionLike = inertSession): CdpConnection {
  let targetSeq = 0
  let sessionSeq = 0
  return {
    async send(method, params) {
      if (method === 'Target.createTarget') return { targetId: `T${++targetSeq}` } as never
      if (method === 'Target.attachToTarget') return { sessionId: `S${++sessionSeq}` } as never
      if (method === 'Target.closeTarget') return { success: true } as never
      return session.send(method, params) as never
    },
    on(method, handler: CdpEventHandler) {
      session.on(method, handler as (p: unknown) => void)
      return () => {}
    },
    onClose() {}, isOpen() { return true }, close() {},
  }
}

export function fakeFetch(targets: unknown[] = []): typeof fetch {
  return (async (input: unknown) => {
    const url = new URL(String(input))
    if (url.pathname === '/json/version') return { ok: true, json: async () => ({ webSocketDebuggerUrl: 'ws://browser' }) } as unknown as Response
    if (url.pathname === '/json/list') return { ok: true, json: async () => targets } as unknown as Response
    throw new Error(`unexpected fetch ${url.pathname}`)
  }) as unknown as typeof fetch
}

/** getManager seam returning ONE cached manager backed by the given mock session. */
export function fakeGetManager(session: SessionLike = inertSession, targets: unknown[] = []): () => Promise<BrowserManager> {
  let cached: BrowserManager | undefined
  return async () => {
    if (cached && cached.isOpen()) return cached
    cached = await createBrowserManager({
      chromeOrigin: 'http://127.0.0.1:9222',
      fetchImpl: fakeFetch(targets),
      connect: async () => fakeBrowserConnection(session),
    })
    return cached
  }
}
```

- [ ] **Step 2: Write the failing wrapper test**

Create `packages/research-crawler/tests/browser/cdp-capture-session.test.ts`:

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { withCdpCaptureSession } from '../../src/core/chrome/cdp-capture-session.js'
import { fakeGetManager } from './fake-browser.js'
import type { ChromeTarget } from '../../src/core/chrome/chrome-connector.js'

test('openNewTab path: opens a tab, runs body with a session, reports openedTabId', async () => {
  const getManager = fakeGetManager()
  const seen: { hasSession: boolean; openedTabId?: string; targetId: string } = { hasSession: false, targetId: '' }
  const result = await withCdpCaptureSession<string>(
    {
      chromeOrigin: 'http://127.0.0.1:9222',
      navigateUrl: 'https://www.instagram.com/p/Abc/',
      openNewTab: true,
      keepTabOpen: false,
      getManager,
      resolveTarget: async () => { throw new Error('should not resolve when opening a new tab') },
      noSocketMessage: 'no socket',
    },
    async ({ session, target, openedTabId }) => {
      seen.hasSession = typeof session.send === 'function'
      seen.openedTabId = openedTabId
      seen.targetId = target.id
      await session.send('Runtime.evaluate', { expression: '1' })
      return 'done'
    },
  )
  assert.deepEqual(result, { ok: true, result: 'done' })
  assert.equal(seen.hasSession, true)
  assert.equal(seen.openedTabId, seen.targetId)
})

test('reuse path: attaches to the target returned by resolveTarget', async () => {
  const getManager = fakeGetManager()
  const target: ChromeTarget = { id: 'EXIST', type: 'page', url: 'https://www.instagram.com/', webSocketDebuggerUrl: 'ws://e' }
  const result = await withCdpCaptureSession<string>(
    {
      chromeOrigin: 'http://127.0.0.1:9222',
      navigateUrl: undefined,
      openNewTab: false,
      keepTabOpen: false,
      getManager,
      resolveTarget: async () => target,
      noSocketMessage: 'no socket',
    },
    async ({ target: t, openedTabId }) => {
      assert.equal(t.id, 'EXIST')
      assert.equal(openedTabId, undefined)
      return 'ok'
    },
  )
  assert.deepEqual(result, { ok: true, result: 'ok' })
})

test('invalid chromeOrigin returns invalid-input', async () => {
  const result = await withCdpCaptureSession<string>(
    {
      chromeOrigin: 'not-a-url',
      navigateUrl: 'https://x/',
      openNewTab: true,
      keepTabOpen: false,
      getManager: fakeGetManager(),
      resolveTarget: async () => { throw new Error('x') },
      noSocketMessage: 'no socket',
    },
    async () => 'unused',
  )
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.reason, 'invalid-input')
})

test('resolveTarget failure on reuse path returns tab-not-found', async () => {
  const result = await withCdpCaptureSession<string>(
    {
      chromeOrigin: 'http://127.0.0.1:9222',
      navigateUrl: undefined,
      openNewTab: false,
      keepTabOpen: false,
      getManager: fakeGetManager(),
      resolveTarget: async () => { throw new Error('No Chrome tab') },
      noSocketMessage: 'open the browser',
    },
    async () => 'unused',
  )
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.reason, 'tab-not-found')
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --import tsx --test tests/browser/cdp-capture-session.test.ts`
Expected: FAIL — `getManager` not accepted / `withCdpCaptureSession` still uses the old connect path.

- [ ] **Step 4: Reimplement `withCdpCaptureSession`**

Replace the entire contents of `packages/research-crawler/src/core/chrome/cdp-capture-session.ts` with:

```ts
import { normalizeChromeOrigin, type ChromeTarget } from "./chrome-connector.js";
import { createLegacySession } from "../browser/legacy-session-adapter.js";
import { browserRegistry } from "../browser/browser-registry.js";
import type { BrowserManager, ConnectFn } from "../browser/browser-manager.js";
import type { Tab } from "../browser/tab.js";
import type { CdpSession } from "./cdp-session.js";

/**
 * Shared lifecycle scaffolding for every CDP capture flow (Instagram, ChatGPT,
 * Qwen). Runs over the multiplexed BrowserManager: it acquires a Tab (a fresh
 * one for openNewTab, or an attach to the target resolveTarget returns) and
 * hands the body a legacy CdpSession bound to that tab. Closes the tab in a
 * finally unless keepTabOpen.
 */

export type ResolveCdpTargetFn = (args: {
  chromeOrigin: string;
  fetchImpl?: typeof fetch;
}) => Promise<ChromeTarget>;

export type GetManagerFn = (args: {
  chromeOrigin: string;
  fetchImpl?: typeof fetch;
  connect?: ConnectFn;
}) => Promise<BrowserManager>;

export type CdpCaptureSessionOptions = {
  chromeOrigin: string | undefined;
  navigateUrl: string | undefined;
  resolveTarget: ResolveCdpTargetFn;
  openNewTab: boolean;
  keepTabOpen: boolean;
  fetchImpl?: typeof fetch;
  /** Browser-level connection factory, forwarded to the manager (tests/Flow injection). */
  connect?: ConnectFn;
  /** Resolve the BrowserManager for this origin. Defaults to the shared browserRegistry. */
  getManager?: GetManagerFn;
  /** Caller-supplied message shown when the tab is found but has no CDP socket. */
  noSocketMessage: string;
};

export type CdpCaptureSessionContext = {
  chromeOrigin: string;
  navigateUrl: string | undefined;
  session: CdpSession;
  target: ChromeTarget;
  /** Present only when openNewTab was true. */
  openedTabId: string | undefined;
};

export type CdpCaptureSessionFailure =
  | { ok: false; reason: "invalid-input"; message: string }
  | { ok: false; reason: "tab-not-found"; message: string };

const defaultGetManager: GetManagerFn = (args) => browserRegistry.get(args);

export async function withCdpCaptureSession<T>(
  opts: CdpCaptureSessionOptions,
  body: (ctx: CdpCaptureSessionContext) => Promise<T>,
): Promise<{ ok: true; result: T } | CdpCaptureSessionFailure> {
  let chromeOrigin: string;
  try {
    chromeOrigin = normalizeChromeOrigin(opts.chromeOrigin);
  } catch (error) {
    return { ok: false, reason: "invalid-input", message: error instanceof Error ? error.message : "Chrome origin is invalid." };
  }

  let manager: BrowserManager;
  try {
    manager = await (opts.getManager ?? defaultGetManager)({
      chromeOrigin,
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      ...(opts.connect ? { connect: opts.connect } : {}),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: "tab-not-found", message: `Browser connection is not reachable at ${chromeOrigin}: ${detail}` };
  }

  let tab: Tab;
  let target: ChromeTarget;
  let openedTabId: string | undefined;
  try {
    if (opts.openNewTab && opts.navigateUrl) {
      tab = await manager.newTab(opts.navigateUrl);
      openedTabId = tab.targetId;
      target = { id: tab.targetId, type: "page", url: opts.navigateUrl, webSocketDebuggerUrl: "" };
    } else {
      const resolved = await opts.resolveTarget({ chromeOrigin, ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}) });
      tab = await manager.attach(resolved);
      target = resolved;
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: "tab-not-found",
      message: opts.openNewTab
        ? `Failed to open new Chrome tab at ${chromeOrigin}: ${detail}`
        : `Browser data connection is not reachable at ${chromeOrigin}: ${detail}`,
    };
  }

  const session = createLegacySession(tab);
  try {
    const result = await body({ chromeOrigin, navigateUrl: opts.navigateUrl, session, target, openedTabId });
    return { ok: true, result };
  } finally {
    if (!opts.keepTabOpen) await tab.close();
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --import tsx --test tests/browser/cdp-capture-session.test.ts`
Expected: PASS — 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/research-crawler/src/core/chrome/cdp-capture-session.ts packages/research-crawler/tests/browser/fake-browser.ts packages/research-crawler/tests/browser/cdp-capture-session.test.ts
git commit -m "feat(research-crawler): run withCdpCaptureSession over BrowserManager"
```

---

## Task 6: Migrate Instagram capture service to the getManager seam

Only the seam type changes (`connectSession` → `getManager` + `connect`). Capture logic is untouched. The service's `extractEmbeddedPostResponses` helper still takes a `CdpSession`, so keep that type import.

**Files:**
- Modify: `packages/research-crawler/src/core/services/instagram-cdp-capture.service.ts`
- Modify: `packages/research-crawler/tests/instagram-cdp-capture.service.test.ts`

- [ ] **Step 1: Update the service options + forwarding**

In `packages/research-crawler/src/core/services/instagram-cdp-capture.service.ts`:

Change line 1 from `import { type CdpSession } from "../chrome/cdp-session.js";` to a type-only import plus the manager types:

```ts
import type { CdpSession } from "../chrome/cdp-session.js";
import type { BrowserManager, ConnectFn } from "../browser/browser-manager.js";
```

Replace the `InstagramCdpCaptureServiceOptions` type:

```ts
export type InstagramCdpCaptureServiceOptions = {
  fetchImpl?: typeof fetch;
  connect?: ConnectFn;
  getManager?: (args: { chromeOrigin: string; fetchImpl?: typeof fetch; connect?: ConnectFn }) => Promise<BrowserManager>;
};
```

In the `withCdpCaptureSession` call inside `capture`, replace the line `connectSession: options.connectSession,` with:

```ts
          ...(options.connect ? { connect: options.connect } : {}),
          ...(options.getManager ? { getManager: options.getManager } : {}),
```

- [ ] **Step 2: Replace the service test**

Replace the entire contents of `packages/research-crawler/tests/instagram-cdp-capture.service.test.ts`:

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createInstagramCdpCaptureService } from '../src/core/services/instagram-cdp-capture.service.js'
import { fakeGetManager } from './browser/fake-browser.js'

// The fake browser emits no network data and returns {} for every page eval,
// so capture completes empty — but the tab open/close lifecycle is exercised.

test('capture resolves ok over BrowserManager (openNewTab path)', async () => {
  const service = createInstagramCdpCaptureService({ getManager: fakeGetManager() })
  const result = await service.capture({
    url: 'https://www.instagram.com/p/Abc/', openNewTab: true, keepTabOpen: false, timeoutMs: 30, initialDelayMs: 0,
  })
  assert.equal(result.ok, true)
})

test('keepTabOpen=true leaves the opened tab registered after capture', async () => {
  const getManager = fakeGetManager()
  const service = createInstagramCdpCaptureService({ getManager })
  await service.capture({ url: 'https://www.instagram.com/p/Abc/', openNewTab: true, keepTabOpen: true, timeoutMs: 30, initialDelayMs: 0 })
  assert.equal((await getManager()).listTabs().length, 1)
})

test('keepTabOpen=false closes the opened tab after capture', async () => {
  const getManager = fakeGetManager()
  const service = createInstagramCdpCaptureService({ getManager })
  await service.capture({ url: 'https://www.instagram.com/p/Abc/', openNewTab: true, keepTabOpen: false, timeoutMs: 30, initialDelayMs: 0 })
  assert.equal((await getManager()).listTabs().length, 0)
})
```

- [ ] **Step 3: Run test to verify it passes**

Run: `node --import tsx --test tests/instagram-cdp-capture.service.test.ts`
Expected: PASS — 3 tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/research-crawler/src/core/services/instagram-cdp-capture.service.ts packages/research-crawler/tests/instagram-cdp-capture.service.test.ts
git commit -m "refactor(research-crawler): Instagram capture uses BrowserManager getManager seam"
```

---

## Task 7: Migrate ChatGPT service to the getManager seam

The existing test's mock sessions (`mockSession`, `mockDetailsSession`, `mockPromptSession`) are reused **verbatim** — only the service wiring and the obsolete `/json/new`/`/json/close` HTTP assertions change.

**Files:**
- Modify: `packages/research-crawler/src/core/services/chatgpt-cdp-capture.service.ts`
- Modify: `packages/research-crawler/tests/chatgpt-cdp-capture.service.test.ts`

- [ ] **Step 1: Update the service options + forwarding**

In `packages/research-crawler/src/core/services/chatgpt-cdp-capture.service.ts`:

Keep the existing `import { type CdpSession } from "../chrome/cdp-session.js";` (page-eval helpers use it). Add directly below it:

```ts
import type { BrowserManager, ConnectFn } from "../browser/browser-manager.js";
```

Replace `ChatGPTCdpCaptureServiceOptions`:

```ts
export type ChatGPTCdpCaptureServiceOptions = {
  fetchImpl?: typeof fetch;
  connect?: ConnectFn;
  getManager?: (args: { chromeOrigin: string; fetchImpl?: typeof fetch; connect?: ConnectFn }) => Promise<BrowserManager>;
};
```

In **all three** `withCdpCaptureSession` calls (`capture`, `captureDetails`, `sendPrompt`), replace each `connectSession: options.connectSession,` line with:

```ts
          ...(options.connect ? { connect: options.connect } : {}),
          ...(options.getManager ? { getManager: options.getManager } : {}),
```

- [ ] **Step 2: Re-wire the ChatGPT test (keep the mock sessions)**

In `packages/research-crawler/tests/chatgpt-cdp-capture.service.test.ts`:

Add the helper import near the top (after the existing imports):

```ts
import { fakeGetManager } from './browser/fake-browser.js'
```

In **each** of the three tests, make exactly these substitutions (the `mockSession`/`mockDetailsSession`/`mockPromptSession` and body assertions stay):

1. Delete the `const { impl, calls } = mockFetch({ ... })` block at the top of the test.
2. Replace the service construction
   ```ts
   const service = createChatGPTCdpCaptureService({
     fetchImpl: impl,
     connectSession: async () => mockSession(listeners)
   })
   ```
   with (using the matching mock for that test — `mockSession` / `mockDetailsSession` / `mockPromptSession`):
   ```ts
   const service = createChatGPTCdpCaptureService({ getManager: fakeGetManager(mockSession(listeners)) })
   ```
3. Delete the two now-invalid transport assertions wherever they appear:
   ```ts
   assert.ok(calls.includes('PUT /json/new'))
   assert.ok(calls.includes('GET /json/close'))
   ```

Then delete the now-unused top-level helpers `jsonResponse`, `mockFetch`, and the `newTabTarget` const (they are no longer referenced). Leave `mockSession`, `mockDetailsSession`, `mockPromptSession`, `DETAIL_BODY`, `PROMPT_BODY` and all body assertions exactly as they are.

- [ ] **Step 3: Run test to verify it passes**

Run: `node --import tsx --test tests/chatgpt-cdp-capture.service.test.ts`
Expected: PASS — all three ChatGPT tests pass (conversation list, details, send prompt).

- [ ] **Step 4: Commit**

```bash
git add packages/research-crawler/src/core/services/chatgpt-cdp-capture.service.ts packages/research-crawler/tests/chatgpt-cdp-capture.service.test.ts
git commit -m "refactor(research-crawler): ChatGPT capture uses BrowserManager getManager seam"
```

---

## Task 8: ~~Migrate Qwen service to the getManager seam~~ — DEFERRED TO PHASE 3

**Discovered during execution:** Qwen does **not** use `withCdpCaptureSession`. It has its own `openSession` helper (`qwen-cdp-capture.service.ts`) that calls `openChromeTab`/`resolveQwenTarget` + `connectCdpSession` directly — the same pattern as Flow / Instagram discovery / login-detector, which this plan already defers to Phase 3. It is therefore **out of Phase 2's wiring scope** (Phase 2 covers only the `withCdpCaptureSession` consumers: Instagram capture + ChatGPT). Qwen's service and test are left untouched and continue to pass on the legacy `connectCdpSession` transport. Migrating Qwen's `openSession` onto `BrowserManager` moves to Phase 3 alongside Flow/discovery/login-detector.

_Original (now-deferred) task description retained below for Phase 3 reference._

Qwen mirrors ChatGPT in shape. Its test has four cases (`capture`, `captureDetails`, `sendPrompt`, not-logged-in), all reusing their existing mock sessions verbatim.

**Files:**
- Modify: `packages/research-crawler/src/core/services/qwen-cdp-capture.service.ts`
- Modify: `packages/research-crawler/tests/qwen-cdp-capture.service.test.ts`

- [ ] **Step 1: Update the service options + forwarding**

In `packages/research-crawler/src/core/services/qwen-cdp-capture.service.ts`:

Keep the existing `CdpSession` import (page-eval helpers use it). Add below it:

```ts
import type { BrowserManager, ConnectFn } from "../browser/browser-manager.js";
```

Replace the service options type (`QwenCdpCaptureServiceOptions`):

```ts
export type QwenCdpCaptureServiceOptions = {
  fetchImpl?: typeof fetch;
  connect?: ConnectFn;
  getManager?: (args: { chromeOrigin: string; fetchImpl?: typeof fetch; connect?: ConnectFn }) => Promise<BrowserManager>;
};
```

In **every** `withCdpCaptureSession` call in the file (`capture`, `captureDetails`, `sendPrompt`), replace each `connectSession: options.connectSession,` line with:

```ts
          ...(options.connect ? { connect: options.connect } : {}),
          ...(options.getManager ? { getManager: options.getManager } : {}),
```

- [ ] **Step 2: Re-wire the Qwen test (keep the mock sessions)**

In `packages/research-crawler/tests/qwen-cdp-capture.service.test.ts`:

Add the helper import (after the existing imports):

```ts
import { fakeGetManager } from './browser/fake-browser.js'
```

In **each** of the four tests, make exactly these substitutions (mock sessions `mockListSession`/`mockDetailsSession`/`mockPromptSession`/the inline not-logged-in `session`, and all body assertions, stay):

1. Delete the `const { impl, calls } = mockFetch({ ... })` (or `const { impl } = mockFetch({ ... })`) block at the top of the test.
2. Replace the service construction, e.g.
   ```ts
   const service = createQwenCdpCaptureService({ fetchImpl: impl, connectSession: async () => mockListSession(listeners) })
   ```
   with (using the matching mock for that test):
   ```ts
   const service = createQwenCdpCaptureService({ getManager: fakeGetManager(mockListSession(listeners)) })
   ```
   For the not-logged-in test, wrap its inline `session`: `createQwenCdpCaptureService({ getManager: fakeGetManager(session) })`.
3. Delete the now-invalid transport assertions wherever they appear:
   ```ts
   assert.ok(calls.includes('PUT /json/new'))
   assert.ok(calls.includes('GET /json/close'))
   ```

Then delete the now-unused top-level helpers `jsonResponse`, `mockFetch`, and the `newTabTarget` const. Leave the `QWEN_LIST`, `QWEN_DETAIL`, `QWEN_PROMPT_DETAIL`, `evalValue`, the three `mock*Session` functions, and all body assertions exactly as they are.

- [ ] **Step 3: Run test to verify it passes**

Run: `node --import tsx --test tests/qwen-cdp-capture.service.test.ts`
Expected: PASS — all four Qwen tests pass (list, details, send prompt, not-logged-in).

- [ ] **Step 4: Commit**

```bash
git add packages/research-crawler/src/core/services/qwen-cdp-capture.service.ts packages/research-crawler/tests/qwen-cdp-capture.service.test.ts
git commit -m "refactor(research-crawler): Qwen capture uses BrowserManager getManager seam"
```

---

## Task 9: Exports + full verification

**Files:**
- Modify: `packages/research-crawler/src/index.ts`

- [ ] **Step 1: Export the lifecycle helpers**

Append to `packages/research-crawler/src/index.ts` (in the browser-control export block added in Phase 1):

```ts
export { launchBrowserManager, closeBrowserManager } from './core/browser/browser-lifecycle.js'
export type {
  LaunchBrowserManagerOptions,
  CloseBrowserManagerOptions,
} from './core/browser/browser-lifecycle.js'
```

- [ ] **Step 2: Run the full browser test suite**

Run: `node --import tsx --test tests/browser/*.test.ts`
Expected: PASS — all Phase 1 + Phase 2 browser tests pass.

- [ ] **Step 3: Run the migrated service tests**

Run: `node --import tsx --test tests/instagram-cdp-capture.service.test.ts tests/chatgpt-cdp-capture.service.test.ts tests/qwen-cdp-capture.service.test.ts`
Expected: PASS.

- [ ] **Step 4: Typecheck the package**

Run (from repo root): `pnpm --filter @anubis/research-crawler typecheck`
Expected: PASS — no type errors. (If `tsc` flags an unused import in a migrated service or test, delete that import.)

- [ ] **Step 5: Run the whole research-crawler suite (no regression elsewhere)**

Run (from `packages/research-crawler`):
`node --import tsx --test tests/*.test.ts tests/browser/*.test.ts`
Expected: PASS — Flow, avg-likes, json-scanner, standard-output, chrome-connector all still green (their code was untouched).

- [ ] **Step 6: Commit**

```bash
git add packages/research-crawler/src/index.ts
git commit -m "feat(research-crawler): export BrowserManager launch/close lifecycle"
```

---

## Definition of Done (Phase 2)

- `withCdpCaptureSession` runs over `BrowserManager` (single multiplexed socket) with its result contract preserved; Instagram capture and ChatGPT (the two `withCdpCaptureSession` consumers) flow through it.
- `BrowserManager` gains `attach(target)`, event-driven tab eviction, and per-command timeout; `launchBrowserManager`/`closeBrowserManager` own the Chrome process lifecycle.
- The Instagram and ChatGPT service tests drive their original capture assertions through the new `getManager` seam via the shared `fake-browser.ts` helper (ChatGPT mock sessions reused verbatim).
- `pnpm --filter @anubis/research-crawler typecheck` passes; the full research-crawler suite is green; Qwen / Flow / Instagram discovery / login-detector (all still on `connectCdpSession`) are untouched and passing.

## Deferred to Phase 3

- Instagram native `Tab` rewrite (drop the legacy `CdpSession` adapter for capture) + consumer-level parallel batch fan-out across competitors (the headline "faster crawling" payoff — now unblocked, since concurrent `captureInstagramData` calls to one origin share a registry-cached manager and open parallel tabs bounded by its semaphore).
- Migrate **Qwen** (its `openSession` helper), Flow, Instagram discovery, and login-detector off `connectCdpSession` onto `BrowserManager`.
