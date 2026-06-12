# Research-Crawler Browser Manager — Implementation Plan (Phase 1: Foundational Layer)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a structured, multiplexed CDP browser-control layer for `@anubis/research-crawler` — a Browser Manager that owns one Chrome over a single WebSocket, a Tab Registry keyed by `targetId/sessionId`, a per-tab command queue (mutex), a concurrency cap, and a uniform command surface — delivered standalone and fully unit-tested with no changes to existing crawler flows.

**Architecture:** One browser-level `CdpConnection` (single WebSocket) multiplexes all commands and demuxes events by `sessionId`. A `BrowserManager` (one per Chrome process) creates tabs via `Target.createTarget` + `Target.attachToTarget{flatten:true}`, registers each in a `TabRegistry`, and hands back `Tab` handles whose every command runs through a per-tab `CommandQueue`. A `Semaphore` caps concurrent active tabs (default 4). A `BrowserRegistry` caches one manager per Chrome origin. A `legacy-session-adapter` exposes the old `{send,on,close}` `CdpSession` over a `Tab`, ready for Phase 2 wiring.

**Tech Stack:** TypeScript (ESM, `isolatedModules`, explicit `.js` import extensions), Node ≥ 22, `node:test` + `node:assert/strict` (run via `node --import tsx --test`). No new third-party runtime deps.

**Scope boundary (Phase 2, separate plan — NOT in this plan):** reimplementing `withCdpCaptureSession` over `BrowserManager`; migrating the Instagram capture/discover services to the native `Tab` API; consumer-level parallel fan-out across competitors; `BrowserManager.launch()` owning reuse-or-spawn + kill; migrating ChatGPT/Qwen/Flow off the legacy adapter. This plan touches **only new files under `src/core/browser/` + `tests/browser/` + new exports in `src/index.ts`**. Existing files (`cdp-session.ts`, `chrome-connector.ts`, `cdp-capture-session.ts`, all services) are **not modified**, so all existing tests stay green untouched.

**Reference:** design spec at `docs/superpowers/specs/2026-06-12-research-crawler-browser-manager-design.md`.

**Conventions for every task:**
- Work from `packages/research-crawler/`. Run a single test file with:
  `node --import tsx --test tests/browser/<file>.test.ts`
- New source under `src/core/browser/`; new tests under `tests/browser/`.
- Use explicit `.js` extensions on relative imports (ESM rule for this package).
- After the last task, `pnpm --filter @anubis/research-crawler typecheck` must pass.

---

## File Structure

```
packages/research-crawler/src/core/browser/
  cdp-connection.ts          # Task 1 — multiplexed browser-level socket
  command-queue.ts           # Task 2 — per-tab FIFO mutex
  semaphore.ts               # Task 3 — concurrency cap primitive
  tab-registry.ts            # Task 4 — tabId → { targetId, sessionId, queue, state }
  tab.ts                     # Task 5 — Tab handle + command methods
  browser-manager.ts         # Task 6 — per-process: connection + tabs + withTab
  browser-registry.ts        # Task 7 — chromeOrigin → manager cache
  legacy-session-adapter.ts  # Task 8 — { send, on, close } CdpSession over a Tab
packages/research-crawler/tests/browser/
  cdp-connection.test.ts cdp queue/semaphore/registry/tab/manager/registry/adapter tests
packages/research-crawler/src/index.ts   # Task 9 — add exports
```

---

## Task 1: CdpConnection (multiplexed browser-level socket)

**Files:**
- Create: `packages/research-crawler/src/core/browser/cdp-connection.ts`
- Test: `packages/research-crawler/tests/browser/cdp-connection.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/research-crawler/tests/browser/cdp-connection.test.ts`:

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { connectCdpConnection } from '../../src/core/browser/cdp-connection.js'

/** Minimal scriptable fake WebSocket matching the connection's WebSocketLike. */
class FakeSocket {
  readyState = 0
  sent: string[] = []
  private listeners: Record<string, Array<(e: any) => void>> = {}
  constructor(public url: string) {}
  addEventListener(type: string, listener: (e: any) => void) {
    ;(this.listeners[type] ??= []).push(listener)
  }
  send(data: string) { this.sent.push(data) }
  close() { this.readyState = 3; this.emit('close', {}) }
  open() { this.readyState = 1; this.emit('open', {}) }
  emit(type: string, event: any) { for (const l of this.listeners[type] ?? []) l(event) }
  /** Push an inbound CDP message as if Chrome sent it. */
  inbound(message: unknown) { this.emit('message', { data: JSON.stringify(message) }) }
}

function makeConnection() {
  let socket!: FakeSocket
  const ctor = function (url: string) { socket = new FakeSocket(url); queueMicrotask(() => socket.open()); return socket } as any
  return { connect: connectCdpConnection('ws://browser', ctor), getSocket: () => socket }
}

test('send routes a command response back by id', async () => {
  const { connect, getSocket } = makeConnection()
  const connection = await connect
  const socket = getSocket()
  const pending = connection.send('Target.createTarget', { url: 'about:blank' })
  const sent = JSON.parse(socket.sent[0]!)
  assert.equal(sent.method, 'Target.createTarget')
  assert.equal(sent.params.url, 'about:blank')
  socket.inbound({ id: sent.id, result: { targetId: 'T1' } })
  assert.deepEqual(await pending, { targetId: 'T1' })
})

test('send includes sessionId when provided', async () => {
  const { connect, getSocket } = makeConnection()
  const connection = await connect
  const socket = getSocket()
  void connection.send('Page.navigate', { url: 'x' }, 'S1')
  assert.equal(JSON.parse(socket.sent[0]!).sessionId, 'S1')
})

test('events are demuxed to the handler for the matching sessionId only', async () => {
  const { connect, getSocket } = makeConnection()
  const connection = await connect
  const socket = getSocket()
  const a: unknown[] = []
  const b: unknown[] = []
  connection.on('Network.responseReceived', (p) => a.push(p), 'SA')
  connection.on('Network.responseReceived', (p) => b.push(p), 'SB')
  socket.inbound({ method: 'Network.responseReceived', params: { requestId: '1' }, sessionId: 'SA' })
  socket.inbound({ method: 'Network.responseReceived', params: { requestId: '2' }, sessionId: 'SB' })
  assert.deepEqual(a, [{ requestId: '1' }])
  assert.deepEqual(b, [{ requestId: '2' }])
})

test('unsubscribe stops further event delivery', async () => {
  const { connect, getSocket } = makeConnection()
  const connection = await connect
  const socket = getSocket()
  const seen: unknown[] = []
  const off = connection.on('Target.targetCreated', (p) => seen.push(p))
  off()
  socket.inbound({ method: 'Target.targetCreated', params: { x: 1 } })
  assert.deepEqual(seen, [])
})

test('socket close rejects all pending commands', async () => {
  const { connect, getSocket } = makeConnection()
  const connection = await connect
  const socket = getSocket()
  const pending = connection.send('Target.createTarget')
  socket.close()
  await assert.rejects(pending, /closed/i)
  assert.equal(connection.isOpen(), false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/browser/cdp-connection.test.ts`
Expected: FAIL — cannot find module `cdp-connection.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/research-crawler/src/core/browser/cdp-connection.ts`:

```ts
export type CdpEventHandler = (params: unknown) => void | Promise<void>

type WebSocketLike = {
  readyState: number
  send: (data: string) => void
  close: () => void
  addEventListener: (
    type: 'open' | 'message' | 'error' | 'close',
    listener: (event: { data?: unknown; error?: unknown }) => void,
  ) => void
}

export type WebSocketConstructor = new (url: string) => WebSocketLike

export type CdpConnection = {
  /** Send a CDP command. Omit sessionId for browser-level commands. */
  send<T = unknown>(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<T>
  /** Subscribe to a CDP event. Pass sessionId to scope to one tab. Returns an unsubscribe fn. */
  on(method: string, handler: CdpEventHandler, sessionId?: string): () => void
  /** Register a callback fired once when the underlying socket closes. */
  onClose(handler: () => void): void
  isOpen(): boolean
  close(): void
}

type CdpInbound = {
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: { message?: string }
  sessionId?: string
}

const SEP = ' '
const eventKey = (sessionId: string | undefined, method: string) => `${sessionId ?? ''}${SEP}${method}`

export async function connectCdpConnection(
  browserWsUrl: string,
  webSocketConstructor: WebSocketConstructor = getGlobalWebSocket(),
): Promise<CdpConnection> {
  const socket = new webSocketConstructor(browserWsUrl)
  await waitForSocketOpen(socket)

  let nextId = 1
  let open = true
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  const handlers = new Map<string, CdpEventHandler[]>()
  const closeHandlers: Array<() => void> = []

  socket.addEventListener('message', (event) => {
    const message = parseMessage(event.data)
    if (!message) return
    if (typeof message.id === 'number') {
      const entry = pending.get(message.id)
      if (!entry) return
      pending.delete(message.id)
      if (message.error) entry.reject(new Error(message.error.message || 'CDP command failed.'))
      else entry.resolve(message.result)
      return
    }
    if (message.method) {
      const list = handlers.get(eventKey(message.sessionId, message.method))
      if (list) for (const handler of [...list]) void handler(message.params)
    }
  })

  socket.addEventListener('close', () => {
    open = false
    for (const entry of pending.values()) entry.reject(new Error('CDP connection closed.'))
    pending.clear()
    for (const handler of [...closeHandlers]) handler()
  })

  return {
    send<T = unknown>(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
      if (!open) return Promise.reject(new Error('CDP connection closed.'))
      const id = nextId++
      const command: Record<string, unknown> = { id, method, params }
      if (sessionId) command.sessionId = sessionId
      return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
        socket.send(JSON.stringify(command))
      })
    },
    on(method, handler, sessionId) {
      const key = eventKey(sessionId, method)
      handlers.set(key, [...(handlers.get(key) ?? []), handler])
      return () => {
        const list = handlers.get(key)
        if (!list) return
        const next = list.filter((h) => h !== handler)
        if (next.length) handlers.set(key, next)
        else handlers.delete(key)
      }
    },
    onClose(handler) { closeHandlers.push(handler) },
    isOpen() { return open },
    close() { socket.close() },
  }
}

function waitForSocketOpen(socket: WebSocketLike): Promise<void> {
  if (socket.readyState === 1) return Promise.resolve()
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve())
    socket.addEventListener('error', (event) =>
      reject(event.error instanceof Error ? event.error : new Error('CDP socket failed.')),
    )
  })
}

function parseMessage(data: unknown): CdpInbound | null {
  if (typeof data !== 'string') return null
  try { return JSON.parse(data) as CdpInbound } catch { return null }
}

function getGlobalWebSocket(): WebSocketConstructor {
  const ctor = (globalThis as unknown as { WebSocket?: WebSocketConstructor }).WebSocket
  if (!ctor) throw new Error('This Node.js runtime does not provide WebSocket.')
  return ctor
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/browser/cdp-connection.test.ts`
Expected: PASS — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/research-crawler/src/core/browser/cdp-connection.ts packages/research-crawler/tests/browser/cdp-connection.test.ts
git commit -m "feat(research-crawler): multiplexed CdpConnection with sessionId routing"
```

---

## Task 2: CommandQueue (per-tab FIFO mutex)

**Files:**
- Create: `packages/research-crawler/src/core/browser/command-queue.ts`
- Test: `packages/research-crawler/tests/browser/command-queue.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/research-crawler/tests/browser/command-queue.test.ts`:

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createCommandQueue } from '../../src/core/browser/command-queue.js'

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

test('runs tasks one at a time in FIFO order (no overlap)', async () => {
  const queue = createCommandQueue()
  const events: string[] = []
  const task = (name: string, ms: number) => () =>
    (async () => { events.push(`start:${name}`); await delay(ms); events.push(`end:${name}`); return name })()
  const results = await Promise.all([queue.run(task('a', 20)), queue.run(task('b', 1)), queue.run(task('c', 1))])
  assert.deepEqual(results, ['a', 'b', 'c'])
  assert.deepEqual(events, ['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c'])
})

test('a rejected task does not poison later tasks', async () => {
  const queue = createCommandQueue()
  const failing = queue.run(async () => { throw new Error('boom') })
  const ok = queue.run(async () => 'ok')
  await assert.rejects(failing, /boom/)
  assert.equal(await ok, 'ok')
})

test('returns each task its own result/rejection', async () => {
  const queue = createCommandQueue()
  assert.equal(await queue.run(async () => 42), 42)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/browser/command-queue.test.ts`
Expected: FAIL — cannot find module `command-queue.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/research-crawler/src/core/browser/command-queue.ts`:

```ts
export type CommandQueue = {
  /** Run a task after all previously-enqueued tasks settle. Errors are isolated. */
  run<T>(task: () => Promise<T>): Promise<T>
}

export function createCommandQueue(): CommandQueue {
  let tail: Promise<unknown> = Promise.resolve()
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(() => task())
      // Chain off a swallowed copy so one rejection never blocks later tasks.
      tail = result.then(() => undefined, () => undefined)
      return result
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/browser/command-queue.test.ts`
Expected: PASS — 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/research-crawler/src/core/browser/command-queue.ts packages/research-crawler/tests/browser/command-queue.test.ts
git commit -m "feat(research-crawler): per-tab CommandQueue mutex with error isolation"
```

---

## Task 3: Semaphore (concurrency cap)

**Files:**
- Create: `packages/research-crawler/src/core/browser/semaphore.ts`
- Test: `packages/research-crawler/tests/browser/semaphore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/research-crawler/tests/browser/semaphore.test.ts`:

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSemaphore } from '../../src/core/browser/semaphore.js'

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

test('never exceeds the configured max concurrent holders', async () => {
  const sem = createSemaphore(2)
  let active = 0
  let peak = 0
  const job = async () => {
    const release = await sem.acquire()
    active++
    peak = Math.max(peak, active)
    await delay(5)
    active--
    release()
  }
  await Promise.all(Array.from({ length: 6 }, () => job()))
  assert.equal(peak, 2)
})

test('exposes active count and releases let waiters through', async () => {
  const sem = createSemaphore(1)
  const r1 = await sem.acquire()
  assert.equal(sem.active, 1)
  let got = false
  const waiting = sem.acquire().then((r) => { got = true; return r })
  await delay(1)
  assert.equal(got, false)
  r1()
  const r2 = await waiting
  assert.equal(got, true)
  r2()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/browser/semaphore.test.ts`
Expected: FAIL — cannot find module `semaphore.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/research-crawler/src/core/browser/semaphore.ts`:

```ts
export type Semaphore = {
  /** Resolves when a slot is free; call the returned fn to release it. */
  acquire(): Promise<() => void>
  readonly active: number
  readonly max: number
}

export function createSemaphore(max: number): Semaphore {
  const limit = Math.max(1, Math.floor(max))
  let active = 0
  const waiters: Array<() => void> = []

  const release = () => {
    active--
    const next = waiters.shift()
    if (next) next()
  }

  return {
    acquire() {
      return new Promise<() => void>((resolve) => {
        const grant = () => {
          active++
          let released = false
          resolve(() => {
            if (released) return
            released = true
            release()
          })
        }
        if (active < limit) grant()
        else waiters.push(grant)
      })
    },
    get active() { return active },
    get max() { return limit },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/browser/semaphore.test.ts`
Expected: PASS — 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/research-crawler/src/core/browser/semaphore.ts packages/research-crawler/tests/browser/semaphore.test.ts
git commit -m "feat(research-crawler): counting Semaphore for tab concurrency cap"
```

---

## Task 4: TabRegistry

**Files:**
- Create: `packages/research-crawler/src/core/browser/tab-registry.ts`
- Test: `packages/research-crawler/tests/browser/tab-registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/research-crawler/tests/browser/tab-registry.test.ts`:

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTabRegistry, type TabRecord } from '../../src/core/browser/tab-registry.js'
import { createCommandQueue } from '../../src/core/browser/command-queue.js'

const record = (over: Partial<TabRecord> = {}): TabRecord => ({
  tabId: 'tab-1',
  targetId: 'T1',
  sessionId: 'S1',
  url: 'https://example.com/',
  state: 'open',
  queue: createCommandQueue(),
  ...over,
})

test('add/get/list/remove by tabId', () => {
  const reg = createTabRegistry()
  reg.add(record())
  assert.equal(reg.get('tab-1')?.targetId, 'T1')
  assert.equal(reg.list().length, 1)
  reg.remove('tab-1')
  assert.equal(reg.get('tab-1'), undefined)
  assert.equal(reg.list().length, 0)
})

test('lookup by targetId and sessionId', () => {
  const reg = createTabRegistry()
  reg.add(record({ tabId: 'tab-2', targetId: 'T2', sessionId: 'S2' }))
  assert.equal(reg.getByTargetId('T2')?.tabId, 'tab-2')
  assert.equal(reg.getBySessionId('S2')?.tabId, 'tab-2')
  assert.equal(reg.getByTargetId('nope'), undefined)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/browser/tab-registry.test.ts`
Expected: FAIL — cannot find module `tab-registry.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/research-crawler/src/core/browser/tab-registry.ts`:

```ts
import type { CommandQueue } from './command-queue.js'

export type TabState = 'open' | 'closing' | 'closed'

export type TabRecord = {
  tabId: string
  targetId: string
  sessionId: string
  url: string
  state: TabState
  queue: CommandQueue
}

export type TabRegistry = {
  add(record: TabRecord): void
  get(tabId: string): TabRecord | undefined
  getByTargetId(targetId: string): TabRecord | undefined
  getBySessionId(sessionId: string): TabRecord | undefined
  remove(tabId: string): void
  list(): TabRecord[]
}

export function createTabRegistry(): TabRegistry {
  const byTabId = new Map<string, TabRecord>()
  return {
    add(record) { byTabId.set(record.tabId, record) },
    get(tabId) { return byTabId.get(tabId) },
    getByTargetId(targetId) {
      for (const record of byTabId.values()) if (record.targetId === targetId) return record
      return undefined
    },
    getBySessionId(sessionId) {
      for (const record of byTabId.values()) if (record.sessionId === sessionId) return record
      return undefined
    },
    remove(tabId) { byTabId.delete(tabId) },
    list() { return [...byTabId.values()] },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/browser/tab-registry.test.ts`
Expected: PASS — 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/research-crawler/src/core/browser/tab-registry.ts packages/research-crawler/tests/browser/tab-registry.test.ts
git commit -m "feat(research-crawler): TabRegistry keyed by tabId/targetId/sessionId"
```

---

## Task 5: Tab (handle + command methods)

**Files:**
- Create: `packages/research-crawler/src/core/browser/tab.ts`
- Test: `packages/research-crawler/tests/browser/tab.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/research-crawler/tests/browser/tab.test.ts`:

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTab } from '../../src/core/browser/tab.js'
import { createCommandQueue } from '../../src/core/browser/command-queue.js'
import type { TabRecord } from '../../src/core/browser/tab-registry.js'
import type { CdpConnection, CdpEventHandler } from '../../src/core/browser/cdp-connection.js'

type Call = { method: string; params?: Record<string, unknown>; sessionId?: string }

function fakeConnection(responder: (c: Call) => unknown): {
  connection: CdpConnection
  calls: Call[]
  emit: (method: string, params: unknown, sessionId?: string) => void
} {
  const calls: Call[] = []
  const handlers: Array<{ key: string; handler: CdpEventHandler }> = []
  const connection: CdpConnection = {
    async send(method, params, sessionId) {
      calls.push({ method, params, sessionId })
      return responder({ method, params, sessionId }) as never
    },
    on(method, handler, sessionId) {
      const key = `${sessionId ?? ''}:${method}`
      handlers.push({ key, handler })
      return () => {}
    },
    onClose() {},
    isOpen() { return true },
    close() {},
  }
  const emit = (method: string, params: unknown, sessionId?: string) => {
    for (const h of handlers) if (h.key === `${sessionId ?? ''}:${method}`) void h.handler(params)
  }
  return { connection, calls, emit }
}

const makeRecord = (): TabRecord => ({
  tabId: 'tab-1', targetId: 'T1', sessionId: 'S1', url: 'https://example.com/',
  state: 'open', queue: createCommandQueue(),
})

test('navigate enables Page then navigates, all carrying the sessionId', async () => {
  const { connection, calls } = fakeConnection(() => ({}))
  const closed: string[] = []
  const tab = createTab({ record: makeRecord(), connection, onClose: async (id) => { closed.push(id) } })
  await tab.navigate('https://example.com/x')
  assert.deepEqual(calls.map((c) => c.method), ['Page.enable', 'Page.navigate'])
  assert.equal(calls[1]!.params!.url, 'https://example.com/x')
  assert.ok(calls.every((c) => c.sessionId === 'S1'))
})

test('evaluate unwraps Runtime.evaluate result value', async () => {
  const { connection } = fakeConnection((c) =>
    c.method === 'Runtime.evaluate' ? { result: { value: 7 } } : {})
  const tab = createTab({ record: makeRecord(), connection, onClose: async () => {} })
  assert.equal(await tab.evaluate<number>('1+6'), 7)
})

test('on() subscribes scoped to this tab session', async () => {
  const { connection, emit } = fakeConnection(() => ({}))
  const tab = createTab({ record: makeRecord(), connection, onClose: async () => {} })
  const seen: unknown[] = []
  tab.on('Network.responseReceived', (p) => seen.push(p))
  emit('Network.responseReceived', { requestId: '9' }, 'S1')
  emit('Network.responseReceived', { requestId: 'other' }, 'SX')
  assert.deepEqual(seen, [{ requestId: '9' }])
})

test('close delegates to onClose once and flips state', async () => {
  const { connection } = fakeConnection(() => ({}))
  const record = makeRecord()
  const closed: string[] = []
  const tab = createTab({ record, connection, onClose: async (id) => { closed.push(id) } })
  await tab.close()
  await tab.close()
  assert.deepEqual(closed, ['tab-1'])
  assert.equal(record.state, 'closed')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/browser/tab.test.ts`
Expected: FAIL — cannot find module `tab.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/research-crawler/src/core/browser/tab.ts`:

```ts
import type { CdpConnection, CdpEventHandler } from './cdp-connection.js'
import type { TabRecord } from './tab-registry.js'

export type Tab = {
  readonly tabId: string
  readonly targetId: string
  readonly sessionId: string
  navigate(url: string): Promise<void>
  evaluate<T = unknown>(expression: string): Promise<T>
  click(selector: string): Promise<void>
  type(selector: string, text: string): Promise<void>
  screenshot(): Promise<string>
  /** Escape hatch: send any CDP command on this tab's session, through the queue. */
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>
  /** Subscribe to a session-scoped CDP event. Returns an unsubscribe fn. */
  on(method: string, handler: CdpEventHandler): () => void
  close(): Promise<void>
}

export type CreateTabArgs = {
  record: TabRecord
  connection: CdpConnection
  /** Closes the underlying target and removes the tab from the registry. */
  onClose: (tabId: string) => Promise<void>
}

export function createTab({ record, connection, onClose }: CreateTabArgs): Tab {
  const send = <T = unknown>(method: string, params: Record<string, unknown> = {}) =>
    record.queue.run(() => connection.send<T>(method, params, record.sessionId))

  return {
    get tabId() { return record.tabId },
    get targetId() { return record.targetId },
    get sessionId() { return record.sessionId },

    navigate(url) {
      return record.queue.run(async () => {
        await connection.send('Page.enable', {}, record.sessionId)
        await connection.send('Page.navigate', { url }, record.sessionId)
        record.url = url
      })
    },

    async evaluate<T = unknown>(expression: string) {
      const res = await send<{ result?: { value?: unknown } }>('Runtime.evaluate', {
        expression,
        returnByValue: true,
      })
      return res?.result?.value as T
    },

    async click(selector) {
      const literal = JSON.stringify(selector)
      await send('Runtime.evaluate', {
        expression: `(() => { const el = document.querySelector(${literal}); if (!el) throw new Error('selector not found: ' + ${literal}); el.click(); })()`,
      })
    },

    async type(selector, text) {
      const sel = JSON.stringify(selector)
      const val = JSON.stringify(text)
      await send('Runtime.evaluate', {
        expression: `(() => { const el = document.querySelector(${sel}); if (!el) throw new Error('selector not found: ' + ${sel}); el.focus(); el.value = ${val}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); })()`,
      })
    },

    async screenshot() {
      const res = await send<{ data?: string }>('Page.captureScreenshot', {})
      return res?.data ?? ''
    },

    send,

    on(method, handler) {
      return connection.on(method, handler, record.sessionId)
    },

    async close() {
      if (record.state !== 'open') return
      record.state = 'closing'
      await onClose(record.tabId)
      record.state = 'closed'
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/browser/tab.test.ts`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/research-crawler/src/core/browser/tab.ts packages/research-crawler/tests/browser/tab.test.ts
git commit -m "feat(research-crawler): Tab handle with queued command methods"
```

---

## Task 6: BrowserManager (connection + tabs + withTab + concurrency)

**Files:**
- Create: `packages/research-crawler/src/core/browser/browser-manager.ts`
- Test: `packages/research-crawler/tests/browser/browser-manager.test.ts`

Reuses `listChromeTargets`, `normalizeChromeOrigin`, `type ChromeTarget` from the existing `../chrome/chrome-connector.js` (no modification to that file).

- [ ] **Step 1: Write the failing test**

Create `packages/research-crawler/tests/browser/browser-manager.test.ts`:

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBrowserManager } from '../../src/core/browser/browser-manager.js'
import type { CdpConnection, CdpEventHandler } from '../../src/core/browser/cdp-connection.js'

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** /json/version + /json/list fake; everything else throws. */
function fakeFetch(targets: unknown[] = []) {
  return (async (input: unknown) => {
    const url = new URL(String(input))
    if (url.pathname === '/json/version') return { ok: true, json: async () => ({ webSocketDebuggerUrl: 'ws://browser' }) } as unknown as Response
    if (url.pathname === '/json/list') return { ok: true, json: async () => targets } as unknown as Response
    throw new Error(`unexpected fetch ${url.pathname}`)
  }) as unknown as typeof fetch
}

/** Connection whose send() is scripted; records calls; can simulate per-call delay. */
function scriptedConnection(opts: { onSend?: (m: string, p: unknown, s?: string) => void; delays?: Record<string, number> } = {}) {
  let targetSeq = 0
  let sessionSeq = 0
  const connection: CdpConnection = {
    async send(method, params, sessionId) {
      opts.onSend?.(method, params, sessionId)
      const d = opts.delays?.[method]
      if (d) await delay(d)
      if (method === 'Target.createTarget') return { targetId: `T${++targetSeq}` } as never
      if (method === 'Target.attachToTarget') return { sessionId: `S${++sessionSeq}` } as never
      if (method === 'Target.closeTarget') return { success: true } as never
      return {} as never
    },
    on(_m: string, _h: CdpEventHandler) { return () => {} },
    onClose() {},
    isOpen() { return true },
    close() {},
  }
  return connection
}

test('newTab creates + attaches a target and registers tab with targetId/sessionId', async () => {
  const manager = await createBrowserManager({
    chromeOrigin: 'http://127.0.0.1:9222',
    fetchImpl: fakeFetch(),
    connect: async () => scriptedConnection(),
  })
  const tab = await manager.newTab('https://example.com/')
  assert.equal(tab.targetId, 'T1')
  assert.equal(tab.sessionId, 'S1')
  assert.equal(manager.listTabs().length, 1)
})

test('attachExisting attaches to a matching page target', async () => {
  const targets = [{ id: 'TX', type: 'page', url: 'https://www.instagram.com/', webSocketDebuggerUrl: 'ws://x' }]
  const manager = await createBrowserManager({
    chromeOrigin: 'http://127.0.0.1:9222',
    fetchImpl: fakeFetch(targets),
    connect: async () => scriptedConnection(),
  })
  const tab = await manager.attachExisting((t) => t.url.includes('instagram.com'))
  assert.equal(tab.targetId, 'TX')
  assert.equal(tab.sessionId, 'S1')
})

test('withTab closes the tab afterwards unless keepOpen', async () => {
  const closed: unknown[] = []
  const manager = await createBrowserManager({
    chromeOrigin: 'http://127.0.0.1:9222',
    fetchImpl: fakeFetch(),
    connect: async () => scriptedConnection({ onSend: (m, p) => { if (m === 'Target.closeTarget') closed.push(p) } }),
  })
  await manager.withTab({ url: 'https://example.com/' }, async (tab) => { assert.ok(tab.targetId) })
  assert.equal(manager.listTabs().length, 0)
  assert.equal(closed.length, 1)
})

test('semaphore caps concurrent withTab to maxConcurrentTabs', async () => {
  let active = 0
  let peak = 0
  const manager = await createBrowserManager({
    chromeOrigin: 'http://127.0.0.1:9222',
    fetchImpl: fakeFetch(),
    connect: async () => scriptedConnection(),
    maxConcurrentTabs: 2,
  })
  await Promise.all(Array.from({ length: 6 }, () =>
    manager.withTab({ url: 'https://example.com/' }, async () => {
      active++; peak = Math.max(peak, active); await delay(5); active--
    })))
  assert.equal(peak, 2)
})

test('commands on different tabs interleave (cross-tab parallelism)', async () => {
  const order: string[] = []
  const manager = await createBrowserManager({
    chromeOrigin: 'http://127.0.0.1:9222',
    fetchImpl: fakeFetch(),
    connect: async () => scriptedConnection({
      onSend: (m, _p, s) => { if (m === 'Runtime.evaluate') order.push(`eval:${s}`) },
      delays: { 'Runtime.evaluate': 10 },
    }),
    maxConcurrentTabs: 4,
  })
  const a = await manager.newTab('https://a/')
  const b = await manager.newTab('https://b/')
  await Promise.all([a.evaluate('1'), b.evaluate('1')])
  // Both evals were dispatched (one per session); cross-tab work ran concurrently.
  assert.equal(order.length, 2)
  assert.notEqual(order[0], order[1])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/browser/browser-manager.test.ts`
Expected: FAIL — cannot find module `browser-manager.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/research-crawler/src/core/browser/browser-manager.ts`:

```ts
import { connectCdpConnection, type CdpConnection } from './cdp-connection.js'
import { createCommandQueue } from './command-queue.js'
import { createSemaphore } from './semaphore.js'
import { createTab, type Tab } from './tab.js'
import { createTabRegistry, type TabRecord } from './tab-registry.js'
import { listChromeTargets, normalizeChromeOrigin, type ChromeTarget } from '../chrome/chrome-connector.js'

export type ConnectFn = (browserWsUrl: string) => Promise<CdpConnection>

export type BrowserManagerOptions = {
  chromeOrigin: string
  fetchImpl?: typeof fetch
  /** Browser-level CdpConnection factory (defaults to the real WebSocket connector). */
  connect?: ConnectFn
  /** Max tabs that may be active inside withTab() at once (default 4). */
  maxConcurrentTabs?: number
}

export type WithTabOptions = {
  /** Open a fresh tab at this URL. */
  url?: string
  /** Or attach to an existing page target matching this predicate. */
  predicate?: (target: ChromeTarget) => boolean
  /** Leave the tab open after fn returns (default false). */
  keepOpen?: boolean
}

export type BrowserManager = {
  readonly chromeOrigin: string
  newTab(url: string): Promise<Tab>
  attachExisting(predicate: (target: ChromeTarget) => boolean): Promise<Tab>
  withTab<T>(options: WithTabOptions, fn: (tab: Tab) => Promise<T>): Promise<T>
  listTabs(): TabRecord[]
  isOpen(): boolean
  close(): Promise<void>
}

export async function createBrowserManager(options: BrowserManagerOptions): Promise<BrowserManager> {
  const chromeOrigin = normalizeChromeOrigin(options.chromeOrigin)
  const fetchImpl = options.fetchImpl ?? fetch
  const connect = options.connect ?? connectCdpConnection
  const registry = createTabRegistry()
  const semaphore = createSemaphore(options.maxConcurrentTabs ?? 4)

  const browserWsUrl = await getBrowserWebSocketUrl(chromeOrigin, fetchImpl)
  const connection = await connect(browserWsUrl)

  let tabSeq = 0

  const onClose = async (tabId: string): Promise<void> => {
    const record = registry.get(tabId)
    if (!record) return
    try { await connection.send('Target.closeTarget', { targetId: record.targetId }) } catch { /* best-effort */ }
    registry.remove(tabId)
  }

  const register = (targetId: string, sessionId: string, url: string): Tab => {
    const record: TabRecord = {
      tabId: `tab-${++tabSeq}`, targetId, sessionId, url, state: 'open', queue: createCommandQueue(),
    }
    registry.add(record)
    return createTab({ record, connection, onClose })
  }

  const attachTo = async (targetId: string): Promise<string> => {
    const res = await connection.send<{ sessionId?: string }>('Target.attachToTarget', { targetId, flatten: true })
    if (!res?.sessionId) throw new Error(`Target.attachToTarget returned no sessionId for ${targetId}.`)
    return res.sessionId
  }

  return {
    chromeOrigin,

    async newTab(url) {
      const created = await connection.send<{ targetId?: string }>('Target.createTarget', { url })
      if (!created?.targetId) throw new Error('Target.createTarget returned no targetId.')
      const sessionId = await attachTo(created.targetId)
      return register(created.targetId, sessionId, url)
    },

    async attachExisting(predicate) {
      const targets = await listChromeTargets({ chromeOrigin, fetchImpl })
      const target = targets.find((t) => t.type === 'page' && predicate(t))
      if (!target) throw new Error('No matching Chrome page target was found to attach to.')
      const sessionId = await attachTo(target.id)
      return register(target.id, sessionId, target.url)
    },

    async withTab(opts, fn) {
      const release = await semaphore.acquire()
      try {
        const tab = opts.url
          ? await this.newTab(opts.url)
          : await this.attachExisting(opts.predicate ?? (() => true))
        try {
          return await fn(tab)
        } finally {
          if (!opts.keepOpen) await tab.close()
        }
      } finally {
        release()
      }
    },

    listTabs() { return registry.list() },
    isOpen() { return connection.isOpen() },

    async close() {
      for (const record of registry.list()) {
        try { await connection.send('Target.closeTarget', { targetId: record.targetId }) } catch { /* best-effort */ }
        registry.remove(record.tabId)
      }
      connection.close()
    },
  }
}

async function getBrowserWebSocketUrl(chromeOrigin: string, fetchImpl: typeof fetch): Promise<string> {
  const response = await fetchImpl(new URL('/json/version', chromeOrigin))
  if (!response.ok) throw new Error(`Chrome /json/version failed with status ${response.status}.`)
  const payload = (await response.json()) as { webSocketDebuggerUrl?: string }
  if (typeof payload.webSocketDebuggerUrl !== 'string' || !payload.webSocketDebuggerUrl) {
    throw new Error('Chrome /json/version did not return a browser webSocketDebuggerUrl.')
  }
  return payload.webSocketDebuggerUrl
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/browser/browser-manager.test.ts`
Expected: PASS — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/research-crawler/src/core/browser/browser-manager.ts packages/research-crawler/tests/browser/browser-manager.test.ts
git commit -m "feat(research-crawler): BrowserManager with single-socket tabs + concurrency cap"
```

---

## Task 7: BrowserRegistry (chromeOrigin → manager cache)

**Files:**
- Create: `packages/research-crawler/src/core/browser/browser-registry.ts`
- Test: `packages/research-crawler/tests/browser/browser-registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/research-crawler/tests/browser/browser-registry.test.ts`:

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBrowserRegistry } from '../../src/core/browser/browser-registry.js'
import type { CdpConnection, CdpEventHandler } from '../../src/core/browser/cdp-connection.js'

function fakeFetch() {
  return (async (input: unknown) => {
    const url = new URL(String(input))
    if (url.pathname === '/json/version') return { ok: true, json: async () => ({ webSocketDebuggerUrl: 'ws://browser' }) } as unknown as Response
    if (url.pathname === '/json/list') return { ok: true, json: async () => [] } as unknown as Response
    throw new Error(`unexpected fetch ${url.pathname}`)
  }) as unknown as typeof fetch
}

function connectionFactory() {
  let open = true
  const closeHandlers: Array<() => void> = []
  const connection: CdpConnection = {
    async send() { return {} as never },
    on(_m: string, _h: CdpEventHandler) { return () => {} },
    onClose(h) { closeHandlers.push(h) },
    isOpen() { return open },
    close() { open = false; for (const h of closeHandlers) h() },
  }
  return { connection, drop: () => connection.close() }
}

test('returns the same manager for the same origin (cached)', async () => {
  const registry = createBrowserRegistry()
  const opts = { chromeOrigin: 'http://127.0.0.1:9222', fetchImpl: fakeFetch(), connect: async () => connectionFactory().connection }
  const a = await registry.get(opts)
  const b = await registry.get(opts)
  assert.equal(a, b)
})

test('recreates the manager after its connection closes', async () => {
  const registry = createBrowserRegistry()
  let made = 0
  const opts = {
    chromeOrigin: 'http://127.0.0.1:9222',
    fetchImpl: fakeFetch(),
    connect: async () => { made++; return connectionFactory().connection },
  }
  const a = await registry.get(opts)
  await a.close()
  const b = await registry.get(opts)
  assert.notEqual(a, b)
  assert.equal(made, 2)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/browser/browser-registry.test.ts`
Expected: FAIL — cannot find module `browser-registry.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/research-crawler/src/core/browser/browser-registry.ts`:

```ts
import { createBrowserManager, type BrowserManager, type BrowserManagerOptions } from './browser-manager.js'
import { normalizeChromeOrigin } from '../chrome/chrome-connector.js'

export type BrowserRegistry = {
  /** Get (or create) the manager for an origin. Reuses a live one; recreates a closed one. */
  get(options: BrowserManagerOptions): Promise<BrowserManager>
  closeAll(): Promise<void>
}

export function createBrowserRegistry(): BrowserRegistry {
  const managers = new Map<string, BrowserManager>()
  return {
    async get(options) {
      const key = normalizeChromeOrigin(options.chromeOrigin)
      const existing = managers.get(key)
      if (existing && existing.isOpen()) return existing
      const manager = await createBrowserManager(options)
      managers.set(key, manager)
      return manager
    },
    async closeAll() {
      for (const manager of managers.values()) {
        try { await manager.close() } catch { /* best-effort */ }
      }
      managers.clear()
    },
  }
}

/** Process-wide registry for app use (one manager per Chrome origin). */
export const browserRegistry: BrowserRegistry = createBrowserRegistry()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/browser/browser-registry.test.ts`
Expected: PASS — 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/research-crawler/src/core/browser/browser-registry.ts packages/research-crawler/tests/browser/browser-registry.test.ts
git commit -m "feat(research-crawler): BrowserRegistry caching one manager per Chrome origin"
```

---

## Task 8: Legacy session adapter (`{send,on,close}` over a Tab)

**Files:**
- Create: `packages/research-crawler/src/core/browser/legacy-session-adapter.ts`
- Test: `packages/research-crawler/tests/browser/legacy-session-adapter.test.ts`

This builds the bridge Phase 2 will plug into `withCdpCaptureSession`. It returns the **exact** `CdpSession` shape (`send`/`on`/`close`) the existing `network-listener.ts` and services already consume, so they will run unchanged on the multiplexed transport later.

- [ ] **Step 1: Write the failing test**

Create `packages/research-crawler/tests/browser/legacy-session-adapter.test.ts`:

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createLegacySession } from '../../src/core/browser/legacy-session-adapter.js'
import type { Tab } from '../../src/core/browser/tab.js'
import type { CdpSession } from '../../src/core/chrome/cdp-session.js'

function fakeTab() {
  const calls: Array<{ method: string; params?: unknown }> = []
  const subs: Array<{ method: string }> = []
  let closed = 0
  const tab = {
    tabId: 't', targetId: 'T', sessionId: 'S',
    async navigate() {}, async evaluate() { return undefined as never },
    async click() {}, async type() {}, async screenshot() { return '' },
    async send(method: string, params?: Record<string, unknown>) { calls.push({ method, params }); return {} as never },
    on(method: string) { subs.push({ method }); return () => {} },
    async close() { closed++ },
  } as unknown as Tab
  return { tab, calls, subs, closed: () => closed }
}

test('adapter satisfies the CdpSession shape and forwards send/on/close to the tab', async () => {
  const { tab, calls, subs, closed } = fakeTab()
  const session: CdpSession = createLegacySession(tab)
  await session.send('Network.enable')
  session.on('Network.responseReceived', () => {})
  session.close()
  assert.deepEqual(calls, [{ method: 'Network.enable', params: undefined }])
  assert.deepEqual(subs, [{ method: 'Network.responseReceived' }])
  // close() is fire-and-forget; allow the microtask to run.
  await new Promise<void>((r) => setTimeout(r, 1))
  assert.equal(closed(), 1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/browser/legacy-session-adapter.test.ts`
Expected: FAIL — cannot find module `legacy-session-adapter.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/research-crawler/src/core/browser/legacy-session-adapter.ts`:

```ts
import type { CdpSession } from '../chrome/cdp-session.js'
import type { Tab } from './tab.js'

/**
 * Wraps a Tab in the legacy CdpSession interface ({ send, on, close }) so existing
 * consumers (network-listener, platform capture services) can run over the
 * multiplexed BrowserManager transport without code changes. Phase 2 wires this
 * into withCdpCaptureSession.
 */
export function createLegacySession(tab: Tab): CdpSession {
  return {
    send: <T = unknown>(method: string, params?: Record<string, unknown>) => tab.send<T>(method, params),
    on: (method, handler) => { tab.on(method, handler) },
    close: () => { void tab.close() },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/browser/legacy-session-adapter.test.ts`
Expected: PASS — 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add packages/research-crawler/src/core/browser/legacy-session-adapter.ts packages/research-crawler/tests/browser/legacy-session-adapter.test.ts
git commit -m "feat(research-crawler): legacy CdpSession adapter over Tab"
```

---

## Task 9: Public exports + full verification

**Files:**
- Modify: `packages/research-crawler/src/index.ts` (append exports)

- [ ] **Step 1: Add the browser-layer exports**

Append to `packages/research-crawler/src/index.ts` (after the existing exports):

```ts
// Browser-control layer (multiplexed CDP). See docs/superpowers/specs/2026-06-12-research-crawler-browser-manager-design.md
export { connectCdpConnection } from './core/browser/cdp-connection.js'
export type { CdpConnection, CdpEventHandler } from './core/browser/cdp-connection.js'
export { createBrowserManager } from './core/browser/browser-manager.js'
export type {
  BrowserManager,
  BrowserManagerOptions,
  WithTabOptions,
  ConnectFn,
} from './core/browser/browser-manager.js'
export { createBrowserRegistry, browserRegistry } from './core/browser/browser-registry.js'
export type { BrowserRegistry } from './core/browser/browser-registry.js'
export type { Tab } from './core/browser/tab.js'
export type { TabRecord, TabRegistry, TabState } from './core/browser/tab-registry.js'
export { createTabRegistry } from './core/browser/tab-registry.js'
export { createCommandQueue } from './core/browser/command-queue.js'
export type { CommandQueue } from './core/browser/command-queue.js'
export { createSemaphore } from './core/browser/semaphore.js'
export type { Semaphore } from './core/browser/semaphore.js'
export { createLegacySession } from './core/browser/legacy-session-adapter.js'
```

- [ ] **Step 2: Run the full browser test suite**

Run: `node --import tsx --test tests/browser/*.test.ts`
Expected: PASS — all browser tests pass (cdp-connection 5, command-queue 3, semaphore 2, tab-registry 2, tab 4, browser-manager 5, browser-registry 2, legacy-session-adapter 1).

- [ ] **Step 3: Typecheck the package**

Run (from repo root): `pnpm --filter @anubis/research-crawler typecheck`
Expected: PASS — no type errors.

- [ ] **Step 4: Confirm existing tests still pass (no regression)**

Run (from `packages/research-crawler`):
`node --import tsx --test tests/chrome-connector.test.ts tests/instagram-cdp-capture.service.test.ts tests/chatgpt-cdp-capture.service.test.ts tests/qwen-cdp-capture.service.test.ts`
Expected: PASS — unchanged from before (this plan modified no existing source).

- [ ] **Step 5: Commit**

```bash
git add packages/research-crawler/src/index.ts
git commit -m "feat(research-crawler): export browser-control layer"
```

---

## Definition of Done (Phase 1)

- New `src/core/browser/` layer exists with: multiplexed `CdpConnection`, `CommandQueue`, `Semaphore`, `TabRegistry`, `Tab`, `BrowserManager`, `BrowserRegistry`, legacy adapter.
- Every component is unit-tested via injected fake WebSocket/`fetch`/connection seams; cross-tab parallelism and the concurrency cap are proven by tests.
- `pnpm --filter @anubis/research-crawler typecheck` passes.
- All pre-existing tests pass unchanged (no crawler flow touched).
- Layer is exported from `src/index.ts`, ready for Phase 2 wiring.

### Intentionally deferred from the design (to Phase 2)

These spec items are **not** in Phase 1 because they only pay off once real flows run on the layer; they are listed so the omission is explicit, not accidental:

- **Per-command timeout** on `Tab`/`CommandQueue` (a hung CDP command can't yet auto-reject). Add as a wrapper in `Tab.send` in Phase 2.
- **Event-driven tab eviction** — subscribing the `BrowserManager` to `Target.detachedFromTarget` / `Target.targetDestroyed` to auto-remove crashed tabs from the registry. Phase 1 only removes tabs on explicit `close()`.

## Phase 2 (next plan — write after Phase 1 lands)

1. Reimplement `withCdpCaptureSession` over `BrowserManager` (via `browserRegistry` + `createLegacySession`), preserving its options/result shape; update the three service tests (`instagram`/`chatgpt`/`qwen`) to inject a fake `CdpConnection` instead of a per-tab `connectSession`. **Riskiest area:** session-scoped `Network.*` event routing — put the heaviest tests here.
2. Migrate the Instagram capture/discover services to the native `Tab` API.
3. Add `BrowserManager.launch()` owning reuse-or-spawn (`launchChrome`) + `close({ kill })`.
4. Add a consumer-level parallel batch capture (multiple competitors over one manager, bounded by the semaphore).
5. Migrate ChatGPT/Qwen/Flow off the legacy adapter onto the native `Tab` API.
