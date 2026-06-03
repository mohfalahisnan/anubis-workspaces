# Chrome Extension Scraper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the failed Chrome profile-clone path with an in-Chrome MV3 extension that scrapes Instagram from the user's signed-in session. Backend dispatches jobs over a fixed-port WebSocket; existing CDP path stays alive for `profile=public` and `profile=flow`.

**Architecture:** New `packages/extension` (MV3, Vite, TS) connects over WS to a new backend module `packages/backend/src/extension/` (ws-server + in-memory job queue + Zod-validated wire protocol). The `POST /captures/competitors/:id` and `POST /research-crawler/instagram/{discover,capture-profile}` routes dispatch a Job to the extension when `profile === 'login'` and await the result over the same Promise mechanism the WS handler resolves. Avg-likes / persistence run backend-side as today, on extension-returned `ProfileData` / `PostData`.

**Tech Stack:** Hono backend (existing), `ws` npm package (new), Zod (existing), Chrome MV3 manifest + service worker + content scripts, Vite (existing for frontend, new build target for extension), vitest + jsdom (existing patterns).

**Spec:** [docs/superpowers/specs/2026-06-03-chrome-extension-scraper-design.md](../specs/2026-06-03-chrome-extension-scraper-design.md)

---

## Pre-flight check (do this first)

- [ ] **Step 0a: Confirm repo root** — `pwd` prints `C:\Projects\anubis-workspaces` (or equivalent). All paths below are relative to repo root.
- [ ] **Step 0b: Confirm tooling** — `node -v` ≥ `v22`, `pnpm -v` ≥ `9`.
- [ ] **Step 0c: Confirm baseline** — `git log --oneline -1` should be the spec commit (`docs(spec): chrome extension scraper design`). `git status` will show working-tree changes from the in-flight clone work — Task 1 resets those.

---

## Task 1: Reset working tree to pre-clone baseline

The current working tree has unstaged changes from the cookie-clone attempt that the spec explicitly deletes. Bring it back to commit `ad0b52d` for code, keep the spec doc committed. This is a single restore + delete; no tests.

**Files:**
- Restore: `packages/backend/src/captures.ts`, `packages/backend/src/research-crawler.ts`, `packages/backend/src/system.ts`, `packages/backend/tests/crawler-config-merge.test.ts`, `packages/conversation/src/config/app-config.ts`, `packages/frontend/src/pages/settings.tsx`, `packages/research-crawler/src/core/chrome/launch-chrome.ts`
- Delete: `packages/backend/src/profile-clone.ts`, `packages/backend/tests/profile-clone.test.ts`
- Leave untouched: `packages/ai-agent/src/agents/codex/run.ts`, `packages/ai-agent/src/events/stream.ts`, `packages/ai-agent/tests/` (those are unrelated in-flight work owned by another thread)

- [ ] **Step 1.1: Confirm the unrelated `ai-agent` changes are someone else's WIP**

Run: `git diff --stat packages/ai-agent`

If the diff isn't yours, leave it alone (the restore commands below target only crawler/clone-related files). If it IS yours, decide separately whether to stash or include; this plan assumes it's external.

- [ ] **Step 1.2: Restore modified files**

```bash
git restore packages/backend/src/captures.ts packages/backend/src/research-crawler.ts packages/backend/src/system.ts packages/backend/tests/crawler-config-merge.test.ts packages/conversation/src/config/app-config.ts packages/frontend/src/pages/settings.tsx packages/research-crawler/src/core/chrome/launch-chrome.ts packages/frontend/src/api.ts
```

(Restoring `api.ts` too — the in-flight `cloneChromeProfile` helper goes with the clone code.)

Expected: `git status` shows none of those files as modified.

- [ ] **Step 1.3: Delete the untracked clone files**

```bash
rm packages/backend/src/profile-clone.ts packages/backend/tests/profile-clone.test.ts
```

- [ ] **Step 1.4: Verify clean baseline + green tests**

```bash
git status                                # only docs/superpowers/specs/... committed (no unstaged changes for our files)
pnpm typecheck                            # all 7 packages clean
pnpm vitest run packages/backend/tests    # 102 / 24 files (baseline from handoff)
```

If anything fails, stop and reconcile before continuing. The baseline must be green.

- [ ] **Step 1.5: No commit** — nothing to commit in this task; we just reset to a known state.

---

## Task 2: Install `ws` dependency + scaffold extension backend module

**Files:**
- Modify: `packages/backend/package.json` (add `ws` + `@types/ws`)
- Create: `packages/backend/src/extension/schemas.ts`

- [ ] **Step 2.1: Add `ws`**

```bash
pnpm --filter @anubis/backend add ws
pnpm --filter @anubis/backend add -D @types/ws
```

- [ ] **Step 2.2: Create `packages/backend/src/extension/schemas.ts`**

```ts
import { z } from 'zod'

/* -----------------------------------------------------------
   Wire protocol for the Anubis ↔ extension WebSocket.
   Both directions are JSON text frames. Each frame is one of
   the schemas below; unknown `type`s are dropped server-side
   so we can add fields without breaking older extensions.
   ----------------------------------------------------------- */

export const HelloFrame = z.object({
  type: z.literal('hello'),
  secret: z.string().min(16),
  version: z.string().min(1),
}).strict()

export const ProgressFrame = z.object({
  type: z.literal('progress'),
  jobId: z.string().min(1),
  message: z.string(),
}).strict()

export const ResultFrame = z.object({
  type: z.literal('result'),
  jobId: z.string().min(1),
  ok: z.literal(true),
  data: z.unknown(),
}).strict()

export const ErrorFrame = z.object({
  type: z.literal('error'),
  jobId: z.string().min(1),
  ok: z.literal(false),
  code: z.string().min(1),
  message: z.string(),
}).strict()

export const ExtensionToBackend = z.discriminatedUnion('type', [
  HelloFrame,
  ProgressFrame,
  ResultFrame,
  ErrorFrame,
])

export const DispatchFrame = z.object({
  type: z.literal('dispatch'),
  jobId: z.string().min(1),
  kind: z.enum(['capture-profile', 'discover']),
  input: z.unknown(),
  timeoutMs: z.number().int().positive(),
}).strict()

export const CancelFrame = z.object({
  type: z.literal('cancel'),
  jobId: z.string().min(1),
}).strict()

export const WelcomeFrame = z.object({
  type: z.literal('welcome'),
  backendVersion: z.string(),
}).strict()

export const BackendToExtension = z.discriminatedUnion('type', [
  WelcomeFrame,
  DispatchFrame,
  CancelFrame,
])

export type HelloFrame = z.infer<typeof HelloFrame>
export type ProgressFrame = z.infer<typeof ProgressFrame>
export type ResultFrame = z.infer<typeof ResultFrame>
export type ErrorFrame = z.infer<typeof ErrorFrame>
export type DispatchFrame = z.infer<typeof DispatchFrame>
export type CancelFrame = z.infer<typeof CancelFrame>
export type WelcomeFrame = z.infer<typeof WelcomeFrame>

/**
 * Input shapes the backend passes through to the extension. These
 * mirror the existing crawler input fields the extension needs; the
 * extension does NOT see chromePath / profileDir etc.
 */
export interface CaptureProfileExtInput {
  username: string
  maxResponses: number
}
export interface DiscoverExtInput {
  source: 'explore' | 'hashtag' | 'keyword'
  hashtag?: string
  keyword?: string
  targetCompetitors: number
}
```

- [ ] **Step 2.3: Typecheck**

```bash
pnpm --filter @anubis/backend exec tsc -p tsconfig.json --noEmit
```

Expected: clean.

- [ ] **Step 2.4: Commit**

```bash
git add packages/backend/package.json packages/backend/src/extension/schemas.ts pnpm-lock.yaml
git commit -m "feat(backend/extension): wire-protocol schemas + ws dependency"
```

(`pnpm-lock.yaml` is `.gitignore`d per the handoff — `git add` it only if it's actually tracked here; otherwise skip.)

---

## Task 3: Implement WSServer (test-first)

The server: listens on a fixed range (47891–47900), accepts ONE client at a time (second `hello` evicts the first), validates the secret on the first frame, pings every 25s, fires `onConnect` / `onDisconnect` / `onFrame` callbacks.

**Files:**
- Create: `packages/backend/src/extension/ws-server.ts`
- Create: `packages/backend/tests/extension/ws-server.test.ts`

- [ ] **Step 3.1: Write the failing tests**

`packages/backend/tests/extension/ws-server.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import WebSocket from 'ws'
import { WSServer } from '../../src/extension/ws-server.js'

const SECRET = 'a'.repeat(32)

let server: WSServer
let port: number

beforeEach(async () => {
  server = new WSServer({ secret: SECRET, backendVersion: 'test-0.0.0', portRange: [47891, 47900] })
  port = await server.start()
})

afterEach(async () => {
  await server.stop()
})

function connect(): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${port}/ext`)
}

function waitFor(ws: WebSocket, type: string, timeoutMs = 1000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), timeoutMs)
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.type === type) {
        clearTimeout(timer)
        resolve(msg)
      }
    })
  })
}

describe('WSServer', () => {
  it('accepts a connect with the correct secret and replies with welcome', async () => {
    const ws = connect()
    await new Promise((r) => ws.on('open', r))
    ws.send(JSON.stringify({ type: 'hello', secret: SECRET, version: '0.1.0' }))
    const welcome = (await waitFor(ws, 'welcome')) as { backendVersion: string }
    expect(welcome.backendVersion).toBe('test-0.0.0')
    expect(server.isConnected()).toBe(true)
    expect(server.connectedExtensionVersion()).toBe('0.1.0')
    ws.close()
  })

  it('rejects a bad secret by closing with 4401', async () => {
    const ws = connect()
    await new Promise((r) => ws.on('open', r))
    ws.send(JSON.stringify({ type: 'hello', secret: 'wrong-secret-1234567890123456', version: '0.1.0' }))
    const close = await new Promise<{ code: number }>((resolve) => {
      ws.on('close', (code) => resolve({ code }))
    })
    expect(close.code).toBe(4401)
    expect(server.isConnected()).toBe(false)
  })

  it('a second hello evicts the first connection (single-client)', async () => {
    const a = connect()
    await new Promise((r) => a.on('open', r))
    a.send(JSON.stringify({ type: 'hello', secret: SECRET, version: '0.1.0' }))
    await waitFor(a, 'welcome')

    const aClosed = new Promise<number>((resolve) => a.on('close', (code) => resolve(code)))

    const b = connect()
    await new Promise((r) => b.on('open', r))
    b.send(JSON.stringify({ type: 'hello', secret: SECRET, version: '0.2.0' }))
    await waitFor(b, 'welcome')

    expect(await aClosed).toBe(4409)        // 4409 = "replaced"
    expect(server.connectedExtensionVersion()).toBe('0.2.0')
    b.close()
  })

  it('falls back to a higher port if 47891 is taken', async () => {
    const blocker = new WSServer({ secret: SECRET, backendVersion: 'blocker', portRange: [47891, 47900] })
    const blockerPort = await blocker.start()
    expect(blockerPort).toBe(47891)

    const other = new WSServer({ secret: SECRET, backendVersion: 'other', portRange: [47891, 47900] })
    const otherPort = await other.start()
    expect(otherPort).toBe(47892)

    await blocker.stop()
    await other.stop()
  })

  it('routes inbound frames through onFrame after handshake completes', async () => {
    const seen: unknown[] = []
    server.onFrame = (frame) => { seen.push(frame) }

    const ws = connect()
    await new Promise((r) => ws.on('open', r))
    ws.send(JSON.stringify({ type: 'hello', secret: SECRET, version: '0.1.0' }))
    await waitFor(ws, 'welcome')

    ws.send(JSON.stringify({ type: 'progress', jobId: 'j1', message: 'half done' }))
    // give the server an event-loop tick to process
    await new Promise((r) => setTimeout(r, 50))
    expect(seen).toEqual([{ type: 'progress', jobId: 'j1', message: 'half done' }])
    ws.close()
  })
})
```

- [ ] **Step 3.2: Run the tests, confirm they fail**

```bash
pnpm vitest run packages/backend/tests/extension/ws-server.test.ts
```

Expected: all fail with "Cannot find module ws-server".

- [ ] **Step 3.3: Implement `packages/backend/src/extension/ws-server.ts`**

```ts
import { createServer, type Server as HttpServer } from 'node:http'
import { WebSocketServer, type WebSocket as WS } from 'ws'
import { ExtensionToBackend, type HelloFrame } from './schemas.js'

export interface WSServerOpts {
  secret: string
  backendVersion: string
  /** Inclusive [low, high]. Server tries each in order until bind succeeds. */
  portRange: [number, number]
  /** Override for tests. Defaults to 25_000 (25s). */
  pingIntervalMs?: number
}

interface ActiveClient {
  ws: WS
  extensionVersion: string
  pairedAt: number
  pingTimer: NodeJS.Timeout
}

/* -----------------------------------------------------------
   WSServer
   -----------------------------------------------------------
   Single-client WebSocket server for the Anubis ↔ extension
   wire. Lifecycle:
     1. start()  → binds an HTTP server on the first free port
                   in portRange, attaches a WebSocketServer to
                   the `/ext` upgrade path. Returns the bound
                   port.
     2. client connects, sends a `hello`. If secret matches we
        send `welcome` and route subsequent frames through
        onFrame. If not, close with 4401.
     3. A second valid `hello` evicts the first (close 4409).
     4. stop()  → closes the current client, then the HTTP
                  server.
   ----------------------------------------------------------- */

export class WSServer {
  private http: HttpServer | null = null
  private wss: WebSocketServer | null = null
  private active: ActiveClient | null = null
  private readonly pingIntervalMs: number

  /** Called once per validated inbound frame (after handshake). */
  onFrame: ((frame: unknown) => void) | null = null
  /** Called when a client paired. */
  onConnect: ((info: { version: string; pairedAt: number }) => void) | null = null
  /** Called when the active client goes away (any reason). */
  onDisconnect: (() => void) | null = null

  constructor(private readonly opts: WSServerOpts) {
    this.pingIntervalMs = opts.pingIntervalMs ?? 25_000
  }

  async start(): Promise<number> {
    const [lo, hi] = this.opts.portRange
    for (let port = lo; port <= hi; port++) {
      try {
        const port_ = await this.tryBind(port)
        return port_
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e
        // else try the next port
      }
    }
    throw new Error(`No free port in ${lo}-${hi} for the extension WS server.`)
  }

  private tryBind(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const http = createServer()
      const wss = new WebSocketServer({ server: http, path: '/ext' })

      wss.on('connection', (ws) => this.onConnection(ws))

      http.once('error', (err) => {
        wss.close()
        reject(err)
      })
      http.listen(port, '127.0.0.1', () => {
        this.http = http
        this.wss = wss
        resolve(port)
      })
    })
  }

  async stop(): Promise<void> {
    if (this.active) {
      clearInterval(this.active.pingTimer)
      this.active.ws.close(1000, 'shutdown')
      this.active = null
    }
    await new Promise<void>((resolve) => {
      if (!this.wss) return resolve()
      this.wss.close(() => resolve())
    })
    await new Promise<void>((resolve) => {
      if (!this.http) return resolve()
      this.http.close(() => resolve())
    })
    this.http = null
    this.wss = null
  }

  isConnected(): boolean {
    return this.active !== null
  }
  connectedExtensionVersion(): string | undefined {
    return this.active?.extensionVersion
  }
  pairedAt(): number | undefined {
    return this.active?.pairedAt
  }

  /** Sends a frame to the active client. Returns false if none. */
  send(frame: unknown): boolean {
    if (!this.active) return false
    this.active.ws.send(JSON.stringify(frame))
    return true
  }

  private onConnection(ws: WS): void {
    // First frame MUST be hello; until then we don't route to onFrame.
    let handshaken = false

    ws.on('message', (raw) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw.toString())
      } catch {
        return
      }
      if (!handshaken) {
        const hello = HelloFrame_safeParse(parsed)
        if (!hello.ok || hello.data.secret !== this.opts.secret) {
          ws.close(4401, 'unauthorized')
          return
        }
        handshaken = true
        this.promote(ws, hello.data.version)
        return
      }
      const validated = ExtensionToBackend.safeParse(parsed)
      if (!validated.success) return
      this.onFrame?.(validated.data)
    })

    ws.on('close', () => {
      if (this.active?.ws === ws) {
        clearInterval(this.active.pingTimer)
        this.active = null
        this.onDisconnect?.()
      }
    })
  }

  private promote(ws: WS, version: string): void {
    if (this.active) {
      clearInterval(this.active.pingTimer)
      this.active.ws.close(4409, 'replaced')
      this.active = null
      this.onDisconnect?.()
    }
    const pingTimer = setInterval(() => {
      try { ws.ping() } catch { /* swallow */ }
    }, this.pingIntervalMs)
    this.active = { ws, extensionVersion: version, pairedAt: Date.now(), pingTimer }
    ws.send(JSON.stringify({ type: 'welcome', backendVersion: this.opts.backendVersion }))
    this.onConnect?.({ version, pairedAt: this.active.pairedAt })
  }
}

/** Inline helper so the discriminated union doesn't trip on an extra `type` check. */
function HelloFrame_safeParse(value: unknown):
  | { ok: true; data: HelloFrame }
  | { ok: false } {
  const r = ExtensionToBackend.safeParse(value)
  if (r.success && r.data.type === 'hello') return { ok: true, data: r.data }
  return { ok: false }
}
```

- [ ] **Step 3.4: Run tests, confirm green**

```bash
pnpm vitest run packages/backend/tests/extension/ws-server.test.ts
```

Expected: 5 passed.

- [ ] **Step 3.5: Commit**

```bash
git add packages/backend/src/extension/ws-server.ts packages/backend/tests/extension/ws-server.test.ts
git commit -m "feat(backend/extension): WSServer with single-client handshake + port fallback"
```

---

## Task 4: Implement JobQueue (test-first)

A small queue that backs HTTP requests: `dispatch(kind, input, timeoutMs)` returns a Promise that resolves when a matching `result` frame arrives. Handles `error`, `cancel`, and timeout. Exposes `handleFrame(frame)` to route inbound frames to the right pending Promise.

**Files:**
- Create: `packages/backend/src/extension/job-queue.ts`
- Create: `packages/backend/tests/extension/job-queue.test.ts`

- [ ] **Step 4.1: Write the failing tests**

`packages/backend/tests/extension/job-queue.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { JobQueue, EXTENSION_OFFLINE, EXTENSION_TIMEOUT, EXTENSION_ERROR } from '../../src/extension/job-queue.js'

function makeQueue() {
  const sent: unknown[] = []
  const queue = new JobQueue({
    send: (frame) => { sent.push(frame); return true },
    isConnected: () => true,
  })
  return { queue, sent }
}

describe('JobQueue', () => {
  it('dispatch resolves when a matching result arrives', async () => {
    const { queue, sent } = makeQueue()
    const p = queue.dispatch({ kind: 'capture-profile', input: { username: 'foo' }, timeoutMs: 5000 })
    const dispatched = sent[0] as { type: 'dispatch'; jobId: string }
    expect(dispatched.type).toBe('dispatch')
    queue.handleFrame({ type: 'result', jobId: dispatched.jobId, ok: true, data: { hello: 'world' } })
    expect(await p).toEqual({ hello: 'world' })
  })

  it('dispatch rejects with EXTENSION_ERROR on an error frame', async () => {
    const { queue, sent } = makeQueue()
    const p = queue.dispatch({ kind: 'discover', input: { source: 'explore' }, timeoutMs: 5000 })
    const dispatched = sent[0] as { type: 'dispatch'; jobId: string }
    queue.handleFrame({ type: 'error', jobId: dispatched.jobId, ok: false, code: 'IG_RATE_LIMIT', message: '429' })
    await expect(p).rejects.toMatchObject({ code: EXTENSION_ERROR, inner: { code: 'IG_RATE_LIMIT', message: '429' } })
  })

  it('dispatch rejects with EXTENSION_OFFLINE when no client connected', async () => {
    const queue = new JobQueue({ send: () => false, isConnected: () => false })
    await expect(queue.dispatch({ kind: 'discover', input: {}, timeoutMs: 5000 }))
      .rejects.toMatchObject({ code: EXTENSION_OFFLINE })
  })

  it('dispatch rejects with EXTENSION_TIMEOUT after timeoutMs', async () => {
    vi.useFakeTimers()
    try {
      const { queue, sent } = makeQueue()
      const p = queue.dispatch({ kind: 'discover', input: {}, timeoutMs: 100 })
      void sent // we don't reply
      vi.advanceTimersByTime(150)
      await expect(p).rejects.toMatchObject({ code: EXTENSION_TIMEOUT })
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancel(jobId) sends a cancel frame and rejects the pending promise', async () => {
    const { queue, sent } = makeQueue()
    const p = queue.dispatch({ kind: 'discover', input: {}, timeoutMs: 5000 })
    const dispatched = sent[0] as { type: 'dispatch'; jobId: string }
    queue.cancel(dispatched.jobId)
    expect(sent[1]).toMatchObject({ type: 'cancel', jobId: dispatched.jobId })
    await expect(p).rejects.toMatchObject({ code: 'CANCELLED' })
  })

  it('disconnectAll() rejects every pending job with EXTENSION_OFFLINE', async () => {
    const { queue } = makeQueue()
    const a = queue.dispatch({ kind: 'discover', input: {}, timeoutMs: 5000 })
    const b = queue.dispatch({ kind: 'capture-profile', input: { username: 'x' }, timeoutMs: 5000 })
    queue.disconnectAll()
    await expect(a).rejects.toMatchObject({ code: EXTENSION_OFFLINE })
    await expect(b).rejects.toMatchObject({ code: EXTENSION_OFFLINE })
  })
})
```

- [ ] **Step 4.2: Run tests, confirm fail**

```bash
pnpm vitest run packages/backend/tests/extension/job-queue.test.ts
```

Expected: all fail (module not found).

- [ ] **Step 4.3: Implement `packages/backend/src/extension/job-queue.ts`**

```ts
import { randomUUID } from 'node:crypto'

export const EXTENSION_OFFLINE = 'EXTENSION_OFFLINE'
export const EXTENSION_TIMEOUT = 'EXTENSION_TIMEOUT'
export const EXTENSION_ERROR = 'EXTENSION_ERROR'
export const CANCELLED = 'CANCELLED'

export class ExtensionDispatchError extends Error {
  constructor(public readonly code: string, message: string, public readonly inner?: unknown) {
    super(message)
    this.name = 'ExtensionDispatchError'
  }
}

interface PendingJob {
  resolve: (data: unknown) => void
  reject: (err: ExtensionDispatchError) => void
  timer: NodeJS.Timeout
}

export interface JobQueueTransport {
  send(frame: unknown): boolean
  isConnected(): boolean
}

export interface DispatchOpts {
  kind: 'capture-profile' | 'discover'
  input: unknown
  timeoutMs: number
}

/* -----------------------------------------------------------
   JobQueue
   -----------------------------------------------------------
   In-memory router between HTTP requests and the WS client.
   dispatch() returns a Promise that resolves on a matching
   `result` frame from the extension (or rejects with one of
   EXTENSION_OFFLINE / EXTENSION_ERROR / EXTENSION_TIMEOUT /
   CANCELLED). No persistence; jobs vanish on backend restart.
   ----------------------------------------------------------- */
export class JobQueue {
  private readonly pending = new Map<string, PendingJob>()

  constructor(private readonly transport: JobQueueTransport) {}

  dispatch(opts: DispatchOpts): Promise<unknown> {
    if (!this.transport.isConnected()) {
      return Promise.reject(
        new ExtensionDispatchError(
          EXTENSION_OFFLINE,
          'Anubis extension is not connected. Open Chrome with the extension installed and paired.',
        ),
      )
    }
    const jobId = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(jobId)) {
          reject(new ExtensionDispatchError(EXTENSION_TIMEOUT, `Job ${jobId} timed out after ${opts.timeoutMs}ms`))
        }
      }, opts.timeoutMs)

      this.pending.set(jobId, { resolve, reject, timer })

      const ok = this.transport.send({
        type: 'dispatch',
        jobId,
        kind: opts.kind,
        input: opts.input,
        timeoutMs: opts.timeoutMs,
      })
      if (!ok) {
        clearTimeout(timer)
        this.pending.delete(jobId)
        reject(new ExtensionDispatchError(EXTENSION_OFFLINE, 'Extension dropped between isConnected check and send.'))
      }
    })
  }

  handleFrame(frame: unknown): void {
    if (!isWithJobId(frame)) return
    if (frame.type === 'result' && frame.ok) {
      const job = this.pending.get(frame.jobId)
      if (!job) return
      clearTimeout(job.timer)
      this.pending.delete(frame.jobId)
      job.resolve(frame.data)
    } else if (frame.type === 'error' && frame.ok === false) {
      const job = this.pending.get(frame.jobId)
      if (!job) return
      clearTimeout(job.timer)
      this.pending.delete(frame.jobId)
      job.reject(
        new ExtensionDispatchError(EXTENSION_ERROR, frame.message, { code: frame.code, message: frame.message }),
      )
    }
    // progress frames currently ignored; status broadcasting is a later concern
  }

  cancel(jobId: string): void {
    const job = this.pending.get(jobId)
    if (!job) return
    clearTimeout(job.timer)
    this.pending.delete(jobId)
    this.transport.send({ type: 'cancel', jobId })
    job.reject(new ExtensionDispatchError(CANCELLED, `Job ${jobId} cancelled`))
  }

  disconnectAll(): void {
    for (const [jobId, job] of this.pending) {
      clearTimeout(job.timer)
      job.reject(new ExtensionDispatchError(EXTENSION_OFFLINE, `Extension disconnected before job ${jobId} completed`))
    }
    this.pending.clear()
  }
}

function isWithJobId(frame: unknown): frame is { type: string; jobId: string; ok?: boolean; data?: unknown; code?: string; message?: string } {
  return typeof frame === 'object' && frame !== null
    && 'type' in frame && typeof (frame as { type: unknown }).type === 'string'
    && 'jobId' in frame && typeof (frame as { jobId: unknown }).jobId === 'string'
}
```

- [ ] **Step 4.4: Run tests, confirm green**

```bash
pnpm vitest run packages/backend/tests/extension/job-queue.test.ts
```

Expected: 6 passed.

- [ ] **Step 4.5: Commit**

```bash
git add packages/backend/src/extension/job-queue.ts packages/backend/tests/extension/job-queue.test.ts
git commit -m "feat(backend/extension): JobQueue with timeout, cancel, disconnect handling"
```

---

## Task 5: AppConfig extension fields + auto-generated secret

**Files:**
- Modify: `packages/conversation/src/config/app-config.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/backend/tests/config-route.test.ts`
- Create: `packages/conversation/tests/app-config-extension-secret.test.ts`

- [ ] **Step 5.1: Update `packages/conversation/src/config/app-config.ts`**

Replace the `AppConfig` interface and `sanitize()` function (keep the rest of the file intact). Drop `loginProfileDir` — the new model has no concept of it.

```ts
export interface AppConfig {
  chromePath?: string
  /** Random hex token shared with the extension. 32 bytes (64 hex chars). Auto-generated on first construction if missing. */
  extensionSecret?: string
  /** WS port the backend bound to (47891–47900). Persisted so the extension can probe-and-find. */
  extensionPort?: number
  /** Epoch ms of the most recent successful extension `hello`. UI-only — not used for auth. */
  extensionPairedAt?: number
}
```

Replace `sanitize`:

```ts
function sanitize(obj: Record<string, unknown>): AppConfig {
  const out: AppConfig = {}
  const chromePath = typeof obj.chromePath === 'string' ? obj.chromePath.trim() : ''
  if (chromePath) out.chromePath = chromePath
  const secret = typeof obj.extensionSecret === 'string' ? obj.extensionSecret.trim() : ''
  if (/^[0-9a-f]{32,}$/i.test(secret)) out.extensionSecret = secret
  if (typeof obj.extensionPort === 'number' && obj.extensionPort > 0 && obj.extensionPort < 65536) {
    out.extensionPort = Math.floor(obj.extensionPort)
  }
  if (typeof obj.extensionPairedAt === 'number' && obj.extensionPairedAt > 0) {
    out.extensionPairedAt = Math.floor(obj.extensionPairedAt)
  }
  return out
}
```

Add the auto-generation into the constructor — after the line that sets `this.path`:

```ts
constructor(dataDir: string) {
  this.path = join(dataDir, CONFIG_FILE)
  // Auto-generate the extension secret on first run so the user can
  // paste it into the extension Options page without us ever having
  // a code path where it's missing.
  const current = this.get()
  if (!current.extensionSecret) {
    this.update({ extensionSecret: randomHex(32) })
  }
}

function randomHex(byteLen: number): string {
  const buf = new Uint8Array(byteLen)
  globalThis.crypto.getRandomValues(buf)
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}
```

Import `randomHex` is a top-level free function in the same file — no new node-stdlib import needed.

- [ ] **Step 5.2: Mirror in `packages/shared/src/index.ts`**

Replace the existing `AppConfig` interface:

```ts
export interface AppConfig {
  chromePath?: string
  extensionSecret?: string
  extensionPort?: number
  extensionPairedAt?: number
}
```

Delete the `ChromeProfileInfo` / `ChromeProfilesPayload` interfaces — Settings no longer enumerates Chrome profiles. (They were used only by the now-deleted picker.)

- [ ] **Step 5.3: Update `packages/backend/tests/config-route.test.ts`**

The existing PATCH test uses `loginProfileDir`. Update it to PATCH `chromePath` instead (still a real field). Drop the empty-string clear test for `loginProfileDir` — replace with the same for `chromePath`. Concretely:

```ts
it('PATCH /config merges + persists; subsequent GET sees the value', async () => {
  const { default: app } = await import('../src/app.js')
  const patch = await app.request('/config', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chromePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' }),
  })
  expect(patch.status).toBe(200)
  const patchBody = (await patch.json()) as { ok: boolean; config: { chromePath?: string } }
  expect(patchBody.config.chromePath).toMatch(/chrome\.exe$/)

  const get = await app.request('/config')
  const getBody = (await get.json()) as { config: { chromePath?: string } }
  expect(getBody.config.chromePath).toMatch(/chrome\.exe$/)
})

it('PATCH with empty string clears a value', async () => {
  const { default: app } = await import('../src/app.js')
  const patch = await app.request('/config', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chromePath: '' }),
  })
  const body = (await patch.json()) as { config: { chromePath?: string } }
  expect(body.config.chromePath).toBeUndefined()
})
```

The initial "empty config" test will now show `extensionSecret` populated. Change it:

```ts
it('GET /config returns a config with an auto-generated extensionSecret', async () => {
  const { default: app } = await import('../src/app.js')
  const res = await app.request('/config')
  expect(res.status).toBe(200)
  const body = (await res.json()) as { ok: boolean; config: Record<string, unknown> }
  expect(body.ok).toBe(true)
  expect(body.config.extensionSecret).toMatch(/^[0-9a-f]{64}$/)
  expect(body.config.chromePath).toBeUndefined()
})
```

Also update `packages/backend/src/config.ts`'s `PatchBody` to drop `loginProfileDir` and accept only `chromePath`:

```ts
const PatchBody = z.object({
  chromePath: z.string().optional(),
}).strict()
```

- [ ] **Step 5.4: New test for auto-generation persistence**

`packages/conversation/tests/app-config-extension-secret.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppConfigService } from '../src/config/app-config.js'

let dataDir: string

afterEach(() => {
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
})

describe('AppConfigService extensionSecret', () => {
  it('auto-generates a 64-hex-char secret on first construction', () => {
    dataDir = mkdtempSync(join(tmpdir(), 'anubis-cfg-'))
    const svc = new AppConfigService(dataDir)
    const cfg = svc.get()
    expect(cfg.extensionSecret).toMatch(/^[0-9a-f]{64}$/)
  })

  it('preserves the secret across construction (no clobber)', () => {
    dataDir = mkdtempSync(join(tmpdir(), 'anubis-cfg-'))
    const first = new AppConfigService(dataDir).get().extensionSecret
    const second = new AppConfigService(dataDir).get().extensionSecret
    expect(second).toBe(first)
  })
})
```

- [ ] **Step 5.5: Typecheck + run tests**

```bash
pnpm typecheck
pnpm vitest run packages/backend/tests packages/conversation/tests
```

Expected: all green. (You may need to adjust frontend code that imports `ChromeProfileInfo` / `ChromeProfilesPayload` — Task 19 deletes those imports anyway. For now, leave Settings broken if it errors; we'll repair it there. If the typecheck fails on `settings.tsx`, comment out the body of that file or revert to a stub component returning `null`.)

If `settings.tsx` typecheck fails, replace its contents with a temporary stub:

```tsx
export function SettingsPage() {
  return <div className='p-6'>Settings disabled while extension UI lands.</div>
}
```

- [ ] **Step 5.6: Commit**

```bash
git add packages/conversation/src/config/app-config.ts packages/shared/src/index.ts packages/backend/src/config.ts packages/backend/tests/config-route.test.ts packages/conversation/tests/app-config-extension-secret.test.ts packages/frontend/src/pages/settings.tsx
git commit -m "feat(conversation/config): auto-generated extensionSecret; drop loginProfileDir"
```

---

## Task 6: HTTP routes for extension status + secret reveal/rotate

**Files:**
- Create: `packages/backend/src/extension/routes.ts`
- Modify: `packages/backend/src/app.ts` (mount the new routes)
- Create: `packages/backend/tests/extension/routes.test.ts`

- [ ] **Step 6.1: Write the failing tests**

`packages/backend/tests/extension/routes.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dataDir: string

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'anubis-ext-routes-'))
  process.env.ANUBIS_DATA_DIR = dataDir
})

afterAll(async () => {
  const { shutdownStack } = await import('../../src/services.js')
  await shutdownStack()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('/extension routes', () => {
  it('GET /extension/status returns connected=false with no client', async () => {
    const { default: app } = await import('../../src/app.js')
    const res = await app.request('/extension/status')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; status: { connected: boolean; port: number; dataDirPath: string } }
    expect(body.ok).toBe(true)
    expect(body.status.connected).toBe(false)
    expect(body.status.port).toBeGreaterThanOrEqual(47891)
    expect(body.status.dataDirPath).toContain('extension')
  })

  it('POST /extension/secret/reveal returns the current secret', async () => {
    const { default: app } = await import('../../src/app.js')
    const res = await app.request('/extension/secret/reveal', { method: 'POST' })
    const body = (await res.json()) as { ok: boolean; secret: string }
    expect(body.secret).toMatch(/^[0-9a-f]{64}$/)
  })

  it('POST /extension/secret/rotate returns a new secret different from the old', async () => {
    const { default: app } = await import('../../src/app.js')
    const before = await (await app.request('/extension/secret/reveal', { method: 'POST' })).json() as { secret: string }
    const after = await (await app.request('/extension/secret/rotate', { method: 'POST' })).json() as { secret: string }
    expect(after.secret).not.toBe(before.secret)
    const verify = await (await app.request('/extension/secret/reveal', { method: 'POST' })).json() as { secret: string }
    expect(verify.secret).toBe(after.secret)
  })
})
```

- [ ] **Step 6.2: Implement `packages/backend/src/extension/routes.ts`**

```ts
import { join } from 'node:path'
import { Hono } from 'hono'
import { getStack, getExtensionWS } from '../services.js'

/* -----------------------------------------------------------
   /extension routes
   -----------------------------------------------------------
   Status, secret reveal/rotate. The actual WS bind/listen
   happens in services.ts at stack init time — this file just
   reports state.
   ----------------------------------------------------------- */

export const extensionRoutes = new Hono()

extensionRoutes.get('/status', (c) => {
  const stack = getStack()
  const ws = getExtensionWS()
  const dataDir = process.env.ANUBIS_DATA_DIR ?? join(process.cwd(), '.anubis-data')
  return c.json({
    ok: true,
    status: {
      connected: ws?.isConnected() ?? false,
      extensionVersion: ws?.connectedExtensionVersion(),
      pairedAt: ws?.pairedAt() ?? stack.appConfig.get().extensionPairedAt,
      port: stack.appConfig.get().extensionPort ?? 0,
      dataDirPath: join(dataDir, 'extension'),
    },
  })
})

extensionRoutes.post('/secret/reveal', (c) => {
  const secret = getStack().appConfig.get().extensionSecret ?? ''
  return c.json({ ok: true, secret })
})

extensionRoutes.post('/secret/rotate', (c) => {
  // We can't reuse randomHex from app-config.ts (private). Generate inline.
  const buf = new Uint8Array(32)
  globalThis.crypto.getRandomValues(buf)
  const secret = Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
  const cfg = getStack().appConfig.update({ extensionSecret: secret })
  // Force-disconnect any active client so it re-pairs with the new secret.
  getExtensionWS()?.forceDisconnect('secret-rotated')
  return c.json({ ok: true, secret: cfg.extensionSecret })
})
```

- [ ] **Step 6.3: Add `forceDisconnect` to `WSServer`**

In `packages/backend/src/extension/ws-server.ts`, add a public method:

```ts
forceDisconnect(reason: string): void {
  if (!this.active) return
  clearInterval(this.active.pingTimer)
  this.active.ws.close(4410, reason)
  this.active = null
  this.onDisconnect?.()
}
```

- [ ] **Step 6.4: Mount in `packages/backend/src/app.ts`**

Add to imports:

```ts
import { extensionRoutes } from './extension/routes.js'
```

Mount alongside the others:

```ts
app.route('/extension', extensionRoutes)
```

- [ ] **Step 6.5: Stub `getExtensionWS()` in services.ts**

Open `packages/backend/src/services.ts`. Add this export — Task 7 will wire it for real, but `routes.ts` needs the symbol to exist now.

```ts
import type { WSServer } from './extension/ws-server.js'

let wsServer: WSServer | null = null
export function getExtensionWS(): WSServer | null {
  return wsServer
}
export function _setExtensionWS_forTesting(s: WSServer | null): void {
  wsServer = s
}
```

- [ ] **Step 6.6: Run tests**

```bash
pnpm vitest run packages/backend/tests/extension/routes.test.ts
```

Expected: 3 passed.

- [ ] **Step 6.7: Commit**

```bash
git add packages/backend/src/extension/routes.ts packages/backend/src/extension/ws-server.ts packages/backend/src/app.ts packages/backend/src/services.ts packages/backend/tests/extension/routes.test.ts
git commit -m "feat(backend/extension): /extension/status, /extension/secret routes"
```

---

## Task 7: Wire WSServer into the conversation stack lifecycle

The stack is constructed on first `getStack()`. We extend `services.ts` to also start the WSServer and bind it to the JobQueue.

**Files:**
- Modify: `packages/backend/src/services.ts`
- Create: `packages/backend/tests/extension/dispatch-integration.test.ts`

- [ ] **Step 7.1: Update `packages/backend/src/services.ts`**

Replace the file contents:

```ts
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConversationService, type ConversationStack } from '@anubis/conversation'
import { getBuiltinSkillRoots } from '@anubis/ai-agent'
import { WSServer } from './extension/ws-server.js'
import { JobQueue } from './extension/job-queue.js'

let stack: ConversationStack | null = null
let wsServer: WSServer | null = null
let jobQueue: JobQueue | null = null
let startupPromise: Promise<void> | null = null

const BACKEND_VERSION = '0.1.0'

export function getStack(): ConversationStack {
  if (stack) return stack
  const dataDir = process.env.ANUBIS_DATA_DIR ?? join(tmpdir(), 'anubis')
  const builtin = getBuiltinSkillRoots()
  stack = createConversationService({
    dataDir,
    skillRoots: {
      autoInject: builtin.autoInject,
      optIn: builtin.optIn,
      user: join(dataDir, 'skills'),
    },
  })
  return stack
}

/**
 * Idempotent startup: binds the WS server and remembers the bound
 * port in app config. Routes that need the WS server should `await
 * ensureExtensionStarted()` if they care that it is up.
 */
export async function ensureExtensionStarted(): Promise<void> {
  if (jobQueue) return
  if (startupPromise) return startupPromise
  startupPromise = (async () => {
    const s = getStack()
    const cfg = s.appConfig.get()
    const secret = cfg.extensionSecret
    if (!secret) throw new Error('extensionSecret missing — AppConfigService should have generated it')
    const ws = new WSServer({
      secret,
      backendVersion: BACKEND_VERSION,
      portRange: [47891, 47900],
    })
    const port = await ws.start()
    s.appConfig.update({ extensionPort: port })
    const q = new JobQueue({
      send: (frame) => ws.send(frame),
      isConnected: () => ws.isConnected(),
    })
    ws.onFrame = (frame) => q.handleFrame(frame)
    ws.onConnect = ({ pairedAt }) => { s.appConfig.update({ extensionPairedAt: pairedAt }) }
    ws.onDisconnect = () => { q.disconnectAll() }
    wsServer = ws
    jobQueue = q
  })()
  return startupPromise
}

export function getExtensionWS(): WSServer | null {
  return wsServer
}
export function getJobQueue(): JobQueue | null {
  return jobQueue
}

export async function shutdownStack(): Promise<void> {
  if (wsServer) {
    await wsServer.stop()
    wsServer = null
    jobQueue = null
    startupPromise = null
  }
  if (!stack) return
  await stack.shutdown()
  stack = null
}
```

- [ ] **Step 7.2: Update `apps/desktop/electron/main/backend.ts` (or wherever backend boot lives) to call `ensureExtensionStarted()`**

Open `apps/desktop/electron/main/backend.ts`. Find where the backend is started after `getStack()`. Add `await ensureExtensionStarted()` right after the stack init. If you're not sure where: search for `getStack` in `apps/desktop/electron/main/*.ts` and add the call in the same flow.

If the backend has a top-level entry that already calls `getStack()`, you can instead do the autostart in `packages/backend/src/server.ts` (the spawned backend's entrypoint). Look at that file:

```ts
// near the top of server.ts, after stack init
import { ensureExtensionStarted } from './services.js'
// ...
await ensureExtensionStarted().catch((e) => {
  console.error('[extension] failed to start WS server', e)
})
```

- [ ] **Step 6.3 → 7.3 (renumbered): Update routes.ts to await startup**

In `packages/backend/src/extension/routes.ts`, change the status handler:

```ts
extensionRoutes.get('/status', async (c) => {
  await ensureExtensionStarted()        // idempotent
  const stack = getStack()
  const ws = getExtensionWS()
  // ... rest unchanged
})
```

Add the import:

```ts
import { getStack, getExtensionWS, ensureExtensionStarted } from '../services.js'
```

- [ ] **Step 7.4: Integration test**

`packages/backend/tests/extension/dispatch-integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'

let dataDir: string

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'anubis-ext-int-'))
  process.env.ANUBIS_DATA_DIR = dataDir
  const { default: app } = await import('../../src/app.js')
  // Bounce the status route once to trigger lazy startup.
  await app.request('/extension/status')
})

afterAll(async () => {
  const { shutdownStack } = await import('../../src/services.js')
  await shutdownStack()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('end-to-end extension dispatch over real WS', () => {
  it('a paired client receives dispatched jobs and routes results back', async () => {
    const { default: app } = await import('../../src/app.js')
    const { getJobQueue, getStack } = await import('../../src/services.js')

    const port = getStack().appConfig.get().extensionPort!
    const secret = getStack().appConfig.get().extensionSecret!

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ext`)
    await new Promise((r) => ws.on('open', r))
    ws.send(JSON.stringify({ type: 'hello', secret, version: '0.0.0-test' }))
    await new Promise<void>((r) => ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString())
      if (m.type === 'welcome') r()
    }))

    const queue = getJobQueue()!
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString())
      if (m.type === 'dispatch') {
        ws.send(JSON.stringify({
          type: 'result',
          jobId: m.jobId,
          ok: true,
          data: { echoed: m.input },
        }))
      }
    })

    const result = await queue.dispatch({
      kind: 'capture-profile',
      input: { username: 'someone', maxResponses: 5 },
      timeoutMs: 3000,
    })
    expect(result).toEqual({ echoed: { username: 'someone', maxResponses: 5 } })

    ws.close()

    // Also verify status now reflects connected→disconnected
    await new Promise((r) => setTimeout(r, 100))
    const res = await app.request('/extension/status')
    const body = (await res.json()) as { status: { connected: boolean } }
    expect(body.status.connected).toBe(false)
  })
})
```

- [ ] **Step 7.5: Run tests**

```bash
pnpm vitest run packages/backend/tests/extension
```

Expected: every test under `packages/backend/tests/extension/` green.

- [ ] **Step 7.6: Commit**

```bash
git add packages/backend/src/services.ts packages/backend/src/extension/routes.ts packages/backend/src/server.ts packages/backend/tests/extension/dispatch-integration.test.ts
git commit -m "feat(backend/extension): lifecycle-wired WSServer + JobQueue (lazy auto-start)"
```

---

## Task 8: Scaffold `packages/extension` workspace

**Files:**
- Create: `packages/extension/package.json`
- Create: `packages/extension/tsconfig.json`
- Create: `packages/extension/vite.config.ts`
- Create: `packages/extension/manifest.json`
- Create: `packages/extension/src/background.ts` (stub)
- Create: `packages/extension/src/content/instagram.ts` (stub)
- Create: `packages/extension/src/options/index.html`
- Create: `packages/extension/src/options/index.tsx` (stub)
- Create: `packages/extension/src/popup/index.html`
- Create: `packages/extension/src/popup/index.tsx` (stub)
- Create: `packages/extension/public/icon-128.png` (placeholder — any 128x128 PNG)
- Modify: `pnpm-workspace.yaml` (already covers `packages/*`; verify)

- [ ] **Step 8.1: `packages/extension/package.json`**

```json
{
  "name": "@anubis/extension",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "vite build",
    "dev": "vite build --watch",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "@types/chrome": "^0.0.270",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "jsdom": "^25.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "typescript": "^5.6.0",
    "vite": "^6.0.0",
    "vitest": "^4.0.0",
    "zod": "^3.23.0"
  }
}
```

- [ ] **Step 8.2: `packages/extension/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "outDir": "dist",
    "types": ["chrome", "vite/client"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 8.3: `packages/extension/vite.config.ts`**

The extension build produces multiple HTML entries (options, popup) plus the background service worker as a single ESM file. Use Vite's library/multi-entry mode:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { copyFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-manifest',
      closeBundle() {
        mkdirSync('dist', { recursive: true })
        copyFileSync(resolve('manifest.json'), resolve('dist/manifest.json'))
      },
    },
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: r('./src/background.ts'),
        content: r('./src/content/instagram.ts'),
        options: r('./src/options/index.html'),
        popup: r('./src/popup/index.html'),
      },
      output: {
        // Stable filenames so manifest.json's references don't drift.
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
    target: 'chrome120',
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
})
```

- [ ] **Step 8.4: `packages/extension/manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Anubis Research Crawler",
  "version": "0.1.0",
  "description": "Bridges your Instagram session to the Anubis desktop app for competitor research.",
  "permissions": ["storage", "alarms", "tabs", "windows"],
  "host_permissions": [
    "https://www.instagram.com/*",
    "https://i.instagram.com/*",
    "http://127.0.0.1/*",
    "ws://127.0.0.1/*"
  ],
  "background": { "service_worker": "background.js", "type": "module" },
  "content_scripts": [
    {
      "matches": ["https://www.instagram.com/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "options_page": "options/index.html",
  "action": { "default_popup": "popup/index.html", "default_title": "Anubis" },
  "icons": { "128": "icon-128.png" }
}
```

- [ ] **Step 8.5: Create stub entrypoints**

`packages/extension/src/background.ts`:

```ts
// Stub. Task 9 fills this in.
console.log('Anubis background worker loaded')
```

`packages/extension/src/content/instagram.ts`:

```ts
// Stub. Tasks 15 and 17 fill this in.
console.log('Anubis content script loaded on', location.href)
```

`packages/extension/src/options/index.html`:

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>Anubis Options</title></head>
<body><div id="root"></div><script type="module" src="./index.tsx"></script></body></html>
```

`packages/extension/src/options/index.tsx`:

```tsx
import { createRoot } from 'react-dom/client'
createRoot(document.getElementById('root')!).render(<div>Anubis Options (stub)</div>)
```

`packages/extension/src/popup/index.html`:

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>Anubis</title></head>
<body><div id="root"></div><script type="module" src="./index.tsx"></script></body></html>
```

`packages/extension/src/popup/index.tsx`:

```tsx
import { createRoot } from 'react-dom/client'
createRoot(document.getElementById('root')!).render(<div>Anubis (stub)</div>)
```

- [ ] **Step 8.6: Drop a placeholder icon**

Any 128×128 PNG at `packages/extension/public/icon-128.png`. If you don't have one handy, use the existing Anubis icon from `apps/desktop/build/icons/256x256.png` resized. Vite copies `public/` into `dist/` by default.

- [ ] **Step 8.7: Install deps + build**

```bash
pnpm install
pnpm --filter @anubis/extension build
```

Expected: `packages/extension/dist/` contains `background.js`, `content.js`, `options/index.html` + `options.js`, `popup/index.html` + `popup.js`, `manifest.json`, `icon-128.png`.

- [ ] **Step 8.8: Commit**

```bash
git add packages/extension pnpm-workspace.yaml
git commit -m "feat(extension): MV3 workspace skeleton (background, content, options, popup)"
```

---

## Task 9: Background service worker — WS client + handshake + reconnect

The background worker owns:
- WS connection to backend (with port scan)
- Secret retrieval from `chrome.storage.local`
- `chrome.alarms`-driven keepalive
- Job dispatch routing to content scripts via tab messaging

**Files:**
- Modify: `packages/extension/src/background.ts`
- Create: `packages/extension/src/wire.ts` (shared types, mirrors `packages/backend/src/extension/schemas.ts` shapes — duplicated, not imported across packages)
- Create: `packages/extension/tests/background.test.ts`

- [ ] **Step 9.1: Create `packages/extension/src/wire.ts`**

```ts
/* Mirror of backend wire shapes. We don't import from @anubis/backend
   because the extension is its own build target. Kept in sync by hand
   + the dispatch integration test in backend. */

export type ExtKind = 'capture-profile' | 'discover'

export interface DispatchFrame {
  type: 'dispatch'
  jobId: string
  kind: ExtKind
  input: unknown
  timeoutMs: number
}
export interface CancelFrame { type: 'cancel'; jobId: string }
export interface WelcomeFrame { type: 'welcome'; backendVersion: string }

export type BackendFrame = DispatchFrame | CancelFrame | WelcomeFrame

export interface HelloFrame { type: 'hello'; secret: string; version: string }
export interface ProgressFrame { type: 'progress'; jobId: string; message: string }
export interface ResultFrame { type: 'result'; jobId: string; ok: true; data: unknown }
export interface ErrorFrame { type: 'error'; jobId: string; ok: false; code: string; message: string }

export const PORT_RANGE: readonly number[] = [47891, 47892, 47893, 47894, 47895, 47896, 47897, 47898, 47899, 47900]
```

- [ ] **Step 9.2: Replace `packages/extension/src/background.ts`**

```ts
import {
  PORT_RANGE,
  type BackendFrame,
  type DispatchFrame,
  type ErrorFrame,
  type HelloFrame,
  type ResultFrame,
} from './wire.js'

const EXT_VERSION = chrome.runtime.getManifest().version
const STORAGE_KEYS = {
  secret: 'anubis.secret',
  lastPort: 'anubis.lastPort',
} as const

interface State {
  ws: WebSocket | null
  port: number | null
  reconnectAttempt: number
  jobsByTab: Map<number, string>     // tabId → jobId  (for cleanup on tab close)
  jobsByJob: Map<string, number>     // jobId → tabId
}
const state: State = { ws: null, port: null, reconnectAttempt: 0, jobsByTab: new Map(), jobsByJob: new Map() }

/* -----------------------------------------------------------
   Keepalive
   ----------------------------------------------------------- */
chrome.alarms.create('keepalive', { periodInMinutes: 0.4 })
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'keepalive') void ensureConnected()
})
self.addEventListener('activate', () => void ensureConnected())

/* -----------------------------------------------------------
   Tab cleanup — if the popup the user uses for a job closes,
   reject the job with TAB_CLOSED.
   ----------------------------------------------------------- */
chrome.tabs.onRemoved.addListener((tabId) => {
  const jobId = state.jobsByTab.get(tabId)
  if (!jobId) return
  state.jobsByTab.delete(tabId)
  state.jobsByJob.delete(jobId)
  sendFrame<ErrorFrame>({ type: 'error', jobId, ok: false, code: 'TAB_CLOSED', message: 'Hidden tab closed before completion.' })
})

/* -----------------------------------------------------------
   Connection management
   ----------------------------------------------------------- */
async function ensureConnected(): Promise<void> {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) return
  if (state.ws && state.ws.readyState === WebSocket.CONNECTING) return

  const secret = await getSecret()
  if (!secret) return  // user hasn't paired; popup will prompt

  const orderedPorts = await orderedCandidatePorts()
  for (const port of orderedPorts) {
    const ok = await tryConnect(port, secret)
    if (ok) {
      state.port = port
      state.reconnectAttempt = 0
      await chrome.storage.local.set({ [STORAGE_KEYS.lastPort]: port })
      return
    }
  }
  // All ports refused — schedule a backoff retry.
  state.reconnectAttempt = Math.min(state.reconnectAttempt + 1, 8)
  const delay = Math.min(30_000, 1000 * 2 ** state.reconnectAttempt) + Math.random() * 500
  setTimeout(() => void ensureConnected(), delay)
}

async function orderedCandidatePorts(): Promise<number[]> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.lastPort)
  const last = typeof stored[STORAGE_KEYS.lastPort] === 'number' ? stored[STORAGE_KEYS.lastPort] as number : null
  if (!last) return PORT_RANGE.slice()
  return [last, ...PORT_RANGE.filter((p) => p !== last)]
}

function tryConnect(port: number, secret: string): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ext`)
    let settled = false
    const settle = (ok: boolean) => { if (!settled) { settled = true; resolve(ok) } }
    ws.onopen = () => {
      const hello: HelloFrame = { type: 'hello', secret, version: EXT_VERSION }
      ws.send(JSON.stringify(hello))
    }
    ws.onmessage = (evt) => {
      let frame: BackendFrame
      try { frame = JSON.parse(evt.data as string) as BackendFrame } catch { return }
      if (frame.type === 'welcome') {
        state.ws = ws
        ws.onmessage = handleFrame
        ws.onclose = () => onClose()
        settle(true)
        return
      }
    }
    ws.onclose = () => settle(false)
    ws.onerror = () => settle(false)
    // safety: don't sit on a half-open connection forever
    setTimeout(() => { if (!settled) { try { ws.close() } catch {} settle(false) } }, 2000)
  })
}

function onClose(): void {
  state.ws = null
  setTimeout(() => void ensureConnected(), 1000)
}

function handleFrame(evt: MessageEvent): void {
  let frame: BackendFrame
  try { frame = JSON.parse(evt.data as string) as BackendFrame } catch { return }
  if (frame.type === 'dispatch') void runJob(frame)
  else if (frame.type === 'cancel') cancelJob(frame.jobId)
}

/* -----------------------------------------------------------
   Job execution: open a popup window, content script does the
   actual scraping, posts a result back via chrome.runtime
   messaging.
   ----------------------------------------------------------- */
async function runJob(dispatch: DispatchFrame): Promise<void> {
  const url = targetUrlForJob(dispatch)
  if (!url) {
    sendFrame<ErrorFrame>({ type: 'error', jobId: dispatch.jobId, ok: false, code: 'BAD_INPUT', message: 'unrecognised job kind' })
    return
  }
  const win = await chrome.windows.create({ url, type: 'popup', state: 'minimized', focused: false, width: 800, height: 600 })
  const tabId = win.tabs?.[0]?.id
  if (!tabId) {
    sendFrame<ErrorFrame>({ type: 'error', jobId: dispatch.jobId, ok: false, code: 'TAB_OPEN_FAILED', message: 'Failed to open hidden tab' })
    return
  }
  state.jobsByTab.set(tabId, dispatch.jobId)
  state.jobsByJob.set(dispatch.jobId, tabId)

  // Once the content script reports it's ready, send the job input.
  const listener = (msg: unknown, sender: chrome.runtime.MessageSender) => {
    if (sender.tab?.id !== tabId) return
    const m = msg as { type?: string; jobId?: string; data?: unknown; code?: string; message?: string }
    if (m.type === 'ready') {
      chrome.tabs.sendMessage(tabId, { type: 'execute', jobId: dispatch.jobId, kind: dispatch.kind, input: dispatch.input })
    } else if (m.type === 'result' && m.jobId === dispatch.jobId) {
      sendFrame<ResultFrame>({ type: 'result', jobId: dispatch.jobId, ok: true, data: m.data })
      finishJob(dispatch.jobId)
    } else if (m.type === 'error' && m.jobId === dispatch.jobId) {
      sendFrame<ErrorFrame>({ type: 'error', jobId: dispatch.jobId, ok: false, code: m.code ?? 'CONTENT_ERROR', message: m.message ?? 'content script reported error' })
      finishJob(dispatch.jobId)
    }
  }
  chrome.runtime.onMessage.addListener(listener)

  // Safety: backend's timeoutMs is our outer guard.
  setTimeout(() => {
    if (state.jobsByJob.has(dispatch.jobId)) {
      chrome.runtime.onMessage.removeListener(listener)
      finishJob(dispatch.jobId)
    }
  }, dispatch.timeoutMs + 5_000)
}

function finishJob(jobId: string): void {
  const tabId = state.jobsByJob.get(jobId)
  if (tabId === undefined) return
  state.jobsByJob.delete(jobId)
  state.jobsByTab.delete(tabId)
  chrome.tabs.remove(tabId).catch(() => { /* already closed */ })
}

function cancelJob(jobId: string): void {
  finishJob(jobId)
}

function targetUrlForJob(dispatch: DispatchFrame): string | null {
  if (dispatch.kind === 'capture-profile') {
    const input = dispatch.input as { username?: string }
    if (!input.username) return null
    return `https://www.instagram.com/${encodeURIComponent(input.username)}/`
  }
  if (dispatch.kind === 'discover') {
    const input = dispatch.input as { source?: string; hashtag?: string; keyword?: string }
    if (input.source === 'hashtag' && input.hashtag) return `https://www.instagram.com/explore/tags/${encodeURIComponent(input.hashtag)}/`
    if (input.source === 'keyword') return `https://www.instagram.com/`  // content script uses search API directly; any IG URL is fine
    return `https://www.instagram.com/explore/`
  }
  return null
}

function sendFrame<T>(frame: T): void {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return
  state.ws.send(JSON.stringify(frame))
}

async function getSecret(): Promise<string | null> {
  const out = await chrome.storage.local.get(STORAGE_KEYS.secret)
  const v = out[STORAGE_KEYS.secret]
  return typeof v === 'string' && v.length >= 32 ? v : null
}

// Kick off on load.
void ensureConnected()

// Listen for the options page handing us a fresh secret.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return
  const m = msg as { type?: string; secret?: string }
  if (m.type === 'secret-updated' && typeof m.secret === 'string') {
    if (state.ws) try { state.ws.close() } catch {}
    state.ws = null
    void chrome.storage.local.set({ [STORAGE_KEYS.secret]: m.secret }).then(() => ensureConnected())
    sendResponse({ ok: true })
    return true
  }
  return
})
```

- [ ] **Step 9.3: Write background tests**

`packages/extension/tests/background.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { PORT_RANGE } from '../src/wire.js'

describe('wire constants', () => {
  it('PORT_RANGE covers 47891..47900 inclusive', () => {
    expect(PORT_RANGE[0]).toBe(47891)
    expect(PORT_RANGE[PORT_RANGE.length - 1]).toBe(47900)
    expect(PORT_RANGE.length).toBe(10)
  })
})
```

(Service-worker behaviour is exercised manually in Task 13 and via the backend integration test — unit-testing chrome.* + WebSocket interactions in jsdom is more pain than value here. Keep the test file present so future contributors have somewhere to add focused tests.)

- [ ] **Step 9.4: Build + test**

```bash
pnpm --filter @anubis/extension build
pnpm --filter @anubis/extension test
```

Expected: build succeeds; test passes.

- [ ] **Step 9.5: Commit**

```bash
git add packages/extension/src/background.ts packages/extension/src/wire.ts packages/extension/tests/background.test.ts
git commit -m "feat(extension): background service worker with WS handshake + job routing"
```

---

## Task 10: Options page — pairing UI

User pastes the secret revealed in Anubis Settings; we store it in `chrome.storage.local` and notify the background.

**Files:**
- Modify: `packages/extension/src/options/index.tsx`

- [ ] **Step 10.1: Replace `packages/extension/src/options/index.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

function App() {
  const [secret, setSecret] = useState('')
  const [saved, setSaved] = useState<'idle' | 'saving' | 'ok' | 'err'>('idle')
  const [existing, setExisting] = useState<boolean>(false)

  useEffect(() => {
    void chrome.storage.local.get('anubis.secret').then((r) => {
      setExisting(typeof r['anubis.secret'] === 'string' && (r['anubis.secret'] as string).length >= 32)
    })
  }, [])

  async function save() {
    if (secret.length < 32) { setSaved('err'); return }
    setSaved('saving')
    try {
      await new Promise<void>((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'secret-updated', secret }, (resp) => {
          if (resp?.ok) resolve(); else reject(new Error('background rejected'))
        })
      })
      setSaved('ok')
      setExisting(true)
      setSecret('')
    } catch {
      setSaved('err')
    }
  }

  return (
    <div style={{ fontFamily: 'system-ui', padding: 24, maxWidth: 480 }}>
      <h1 style={{ fontSize: 18, margin: 0 }}>Anubis pairing</h1>
      <p style={{ color: '#555', fontSize: 13 }}>
        Open the Anubis desktop app, go to <strong>Settings → Chrome extension</strong>, click
        <em> Reveal pairing secret</em>, and paste it below.
      </p>
      <input
        type='password'
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
        placeholder='Paste the 64-character secret'
        style={{ width: '100%', fontFamily: 'monospace', fontSize: 13, padding: '8px 10px' }}
      />
      <button
        onClick={() => void save()}
        disabled={saved === 'saving' || secret.length < 32}
        style={{ marginTop: 8, padding: '8px 12px', fontSize: 13, cursor: 'pointer' }}
      >
        {saved === 'saving' ? 'Saving…' : existing ? 'Replace pairing' : 'Pair'}
      </button>
      {saved === 'ok' && <p style={{ color: 'green', fontSize: 12, marginTop: 8 }}>Paired. The popup icon will turn green within a moment.</p>}
      {saved === 'err' && <p style={{ color: '#b00', fontSize: 12, marginTop: 8 }}>Secret must be ≥ 32 characters.</p>}
      {existing && saved === 'idle' && <p style={{ color: '#555', fontSize: 12, marginTop: 8 }}>A secret is already stored. Paste a new one to re-pair.</p>}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
```

- [ ] **Step 10.2: Build + smoke**

```bash
pnpm --filter @anubis/extension build
```

Open `chrome://extensions` in a real Chrome, enable Developer mode, click Load unpacked, point at `packages/extension/dist`. The Options page should render — secret paste works, message posts to background. (No automated test for this; visual smoke.)

- [ ] **Step 10.3: Commit**

```bash
git add packages/extension/src/options/index.tsx
git commit -m "feat(extension/options): pairing UI"
```

---

## Task 11: Popup — connection status pill

**Files:**
- Modify: `packages/extension/src/popup/index.tsx`

- [ ] **Step 11.1: Replace `packages/extension/src/popup/index.tsx`**

The popup talks to the background to read connection state. Add a tiny message contract: popup sends `{ type: 'status?' }`, background replies with `{ connected, port, version }`.

First, extend `background.ts`'s `onMessage` listener (at the bottom of the file):

```ts
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return
  const m = msg as { type?: string }
  if (m.type === 'status?') {
    sendResponse({
      connected: !!state.ws && state.ws.readyState === WebSocket.OPEN,
      port: state.port,
      version: EXT_VERSION,
    })
    return true
  }
  return
})
```

(Keep the existing `secret-updated` branch above it.)

Then the popup:

```tsx
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

interface Status { connected: boolean; port: number | null; version: string }

function App() {
  const [status, setStatus] = useState<Status | null>(null)

  useEffect(() => {
    const tick = () => {
      chrome.runtime.sendMessage({ type: 'status?' }, (resp: Status) => {
        if (chrome.runtime.lastError) { setStatus({ connected: false, port: null, version: '?' }); return }
        setStatus(resp)
      })
    }
    tick()
    const id = window.setInterval(tick, 1500)
    return () => window.clearInterval(id)
  }, [])

  const color = status?.connected ? '#16a34a' : '#b45309'
  return (
    <div style={{ fontFamily: 'system-ui', padding: '12px 14px', minWidth: 200 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: color }} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          {status?.connected ? 'Connected to Anubis' : 'Offline'}
        </span>
      </div>
      <div style={{ fontSize: 11, color: '#666', marginTop: 6 }}>
        {status?.connected ? `Port ${status.port} · v${status.version}` : 'Open the Anubis app, or paste a secret in Options.'}
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
```

- [ ] **Step 11.2: Build + smoke** — `pnpm --filter @anubis/extension build`. Reload extension in chrome://extensions, click the icon: pill renders.

- [ ] **Step 11.3: Commit**

```bash
git add packages/extension/src/background.ts packages/extension/src/popup/index.tsx
git commit -m "feat(extension/popup): connection status pill"
```

---

## Task 12: Backend copies extension into ANUBIS_DATA_DIR on first run

So the user always has a stable "Load unpacked" path.

**Files:**
- Create: `packages/backend/src/extension/install.ts`
- Modify: `packages/backend/src/services.ts` (call `ensureExtensionInstalled` from `ensureExtensionStarted`)
- Create: `packages/backend/tests/extension/install.test.ts`

- [ ] **Step 12.1: `packages/backend/src/extension/install.ts`**

```ts
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/* -----------------------------------------------------------
   First-run install of the bundled extension into
   {ANUBIS_DATA_DIR}/extension/. We copy if either the dir is
   missing, or the version stamp differs.
   ----------------------------------------------------------- */

export interface InstallOpts {
  /** Path to a built extension directory (packages/extension/dist or an electron resources copy). */
  bundleDir: string
  /** Destination root (typically {ANUBIS_DATA_DIR}/extension/). */
  destDir: string
}
export interface InstallResult {
  destDir: string
  installed: boolean
  installedVersion: string | null
}

export function ensureExtensionInstalled(opts: InstallOpts): InstallResult {
  if (!existsSync(opts.bundleDir)) {
    return { destDir: opts.destDir, installed: false, installedVersion: null }
  }
  const bundleVersion = readManifestVersion(join(opts.bundleDir, 'manifest.json'))
  const installedVersion = existsSync(opts.destDir) ? readStamp(opts.destDir) : null

  if (installedVersion === bundleVersion) {
    return { destDir: opts.destDir, installed: false, installedVersion }
  }

  if (existsSync(opts.destDir)) rmSync(opts.destDir, { recursive: true, force: true })
  mkdirSync(opts.destDir, { recursive: true })
  copyTree(opts.bundleDir, opts.destDir)
  writeStamp(opts.destDir, bundleVersion)
  return { destDir: opts.destDir, installed: true, installedVersion: bundleVersion }
}

function readManifestVersion(path: string): string {
  const raw = readFileSync(path, 'utf8')
  const m = JSON.parse(raw) as { version?: string }
  return m.version ?? '0.0.0'
}
function readStamp(dir: string): string | null {
  const path = join(dir, '.anubis-version')
  if (!existsSync(path)) return null
  try { return readFileSync(path, 'utf8').trim() } catch { return null }
}
function writeStamp(dir: string, version: string): void {
  writeFileSync(join(dir, '.anubis-version'), version)
}
function copyTree(src: string, dest: string): void {
  for (const entry of readdirSync(src)) {
    const srcChild = join(src, entry)
    const destChild = join(dest, entry)
    const st = statSync(srcChild)
    if (st.isDirectory()) {
      mkdirSync(destChild, { recursive: true })
      copyTree(srcChild, destChild)
    } else if (st.isFile()) {
      mkdirSync(dirname(destChild), { recursive: true })
      copyFileSync(srcChild, destChild)
    }
  }
}
```

- [ ] **Step 12.2: Test**

`packages/backend/tests/extension/install.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureExtensionInstalled } from '../../src/extension/install.js'

let tmp: string, bundle: string, dest: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'anubis-install-'))
  bundle = join(tmp, 'bundle'); dest = join(tmp, 'dest')
  mkdirSync(bundle, { recursive: true })
  writeFileSync(join(bundle, 'manifest.json'), JSON.stringify({ version: '1.2.3' }))
  writeFileSync(join(bundle, 'background.js'), 'console.log("bg")')
})
afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

describe('ensureExtensionInstalled', () => {
  it('copies the bundle to dest on first run + writes the version stamp', () => {
    const r = ensureExtensionInstalled({ bundleDir: bundle, destDir: dest })
    expect(r.installed).toBe(true)
    expect(r.installedVersion).toBe('1.2.3')
    expect(readFileSync(join(dest, 'background.js'), 'utf8')).toContain('bg')
    expect(readFileSync(join(dest, '.anubis-version'), 'utf8')).toBe('1.2.3')
  })
  it('skips re-copy when stamp matches', () => {
    ensureExtensionInstalled({ bundleDir: bundle, destDir: dest })
    writeFileSync(join(dest, 'background.js'), 'mutated')
    const r2 = ensureExtensionInstalled({ bundleDir: bundle, destDir: dest })
    expect(r2.installed).toBe(false)
    expect(readFileSync(join(dest, 'background.js'), 'utf8')).toBe('mutated')
  })
  it('re-copies when stamp differs', () => {
    ensureExtensionInstalled({ bundleDir: bundle, destDir: dest })
    writeFileSync(join(bundle, 'manifest.json'), JSON.stringify({ version: '1.2.4' }))
    const r = ensureExtensionInstalled({ bundleDir: bundle, destDir: dest })
    expect(r.installed).toBe(true)
    expect(r.installedVersion).toBe('1.2.4')
  })
  it('returns installed=false when bundleDir is missing', () => {
    const r = ensureExtensionInstalled({ bundleDir: join(tmp, 'does-not-exist'), destDir: dest })
    expect(r.installed).toBe(false)
    expect(existsSync(dest)).toBe(false)
  })
})
```

- [ ] **Step 12.3: Call from `ensureExtensionStarted`**

In `packages/backend/src/services.ts`, inside `ensureExtensionStarted` after `getStack()` and before constructing the WSServer:

```ts
const bundleDir = resolveBundleDir()
const dataDirRoot = process.env.ANUBIS_DATA_DIR ?? join(tmpdir(), 'anubis')
const installResult = ensureExtensionInstalled({
  bundleDir,
  destDir: join(dataDirRoot, 'extension'),
})
if (installResult.installed) {
  console.log(`[extension] installed bundle v${installResult.installedVersion} to ${installResult.destDir}`)
}
```

`resolveBundleDir`:

```ts
function resolveBundleDir(): string {
  // 1. When packaged: alongside the backend bundle.
  if (process.env.ANUBIS_EXTENSION_BUNDLE_DIR) return process.env.ANUBIS_EXTENSION_BUNDLE_DIR
  // 2. Dev: monorepo path relative to this file at runtime.
  return join(import.meta.dirname, '..', '..', '..', 'extension', 'dist')
}
```

Add the import:

```ts
import { ensureExtensionInstalled } from './extension/install.js'
```

(For packaged-app the Electron main resolves the real path and sets `ANUBIS_EXTENSION_BUNDLE_DIR` before spawning the backend. Wire that in Task 21.)

- [ ] **Step 12.4: Run tests**

```bash
pnpm vitest run packages/backend/tests/extension
```

Expected: green.

- [ ] **Step 12.5: Commit**

```bash
git add packages/backend/src/extension/install.ts packages/backend/src/services.ts packages/backend/tests/extension/install.test.ts
git commit -m "feat(backend/extension): copy bundle into ANUBIS_DATA_DIR on first run"
```

---

## Task 13: Manual end-to-end smoke

No code; verify the wiring before adding the IG scrape layer.

- [ ] **Step 13.1: Build extension + run backend**

```bash
pnpm --filter @anubis/extension build
pnpm dev
```

- [ ] **Step 13.2: Install in Chrome**

`chrome://extensions` → Developer mode ON → Load unpacked → pick `<ANUBIS_DATA_DIR>/extension/` (Settings page will display the path; alternately just point at `packages/extension/dist`).

- [ ] **Step 13.3: Pair**

Anubis app → Settings (currently the stub) → call `POST /extension/secret/reveal` via DevTools (or curl) to fetch the secret. Open the extension Options page, paste the secret, Pair. Popup pill should turn green.

- [ ] **Step 13.4: Dispatch a fake job**

In a DevTools console talking to the backend (or via curl), POST a dummy:

```bash
curl -X POST http://127.0.0.1:<backend-port>/extension/_debug/echo \
  -H 'content-type: application/json' \
  -d '{"kind":"capture-profile","input":{"username":"someone","maxResponses":3},"timeoutMs":4000}'
```

Wait — this debug route doesn't exist yet. Add it once at the bottom of `packages/backend/src/extension/routes.ts` for this single manual step, then delete it after smoke:

```ts
extensionRoutes.post('/_debug/echo', async (c) => {
  await ensureExtensionStarted()
  const body = await c.req.json()
  const queue = getJobQueue()
  if (!queue) return c.json({ ok: false, error: 'queue not ready' }, 500)
  try {
    const result = await queue.dispatch({ kind: body.kind, input: body.input, timeoutMs: body.timeoutMs ?? 5000 })
    return c.json({ ok: true, result })
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500)
  }
})
```

(Add `getJobQueue` to the import line.)

The extension will open a real instagram.com tab. Since no content script logic exists yet for `capture-profile`, the safety timeout (Task 9 step) will eventually fire `ERROR finishJob`. Confirm in DevTools you see the dispatch frame arriving at the extension (background → console). That's enough for this smoke.

- [ ] **Step 13.5: Roll back the debug route**

Delete `/extension/_debug/echo` from `routes.ts` before continuing. Do NOT commit it.

```bash
git diff packages/backend/src/extension/routes.ts   # confirm clean
```

No commit needed in Task 13 — purely a verification gate.

---

## Task 14: Port IG response parsers + golden-file tests

Bring the existing `@anubis/research-crawler` parsers into the extension as pure functions. They translate IG GraphQL/REST payloads into `ProfileData` / `PostData`. Source-of-truth tests: golden-file fixtures of real (anonymised) IG payloads.

**Files:**
- Create: `packages/extension/src/content/parsers.ts`
- Create: `packages/extension/tests/parsers.test.ts`
- Create: `packages/extension/tests/fixtures/web_profile_info.json` (anonymised real response)
- Create: `packages/extension/tests/fixtures/feed_user.json` (anonymised real response)
- Create: `packages/extension/tests/fixtures/topsearch.json` (anonymised real response)

- [ ] **Step 14.1: Read the existing parser** — `packages/research-crawler/src/core/instagram/` likely has the relevant code. Identify the functions that map `web_profile_info` and `feed/user` responses to `ProfileData` / `PostData`. Port their bodies verbatim into `packages/extension/src/content/parsers.ts`. Keep the same exported names. Do NOT add abstractions.

- [ ] **Step 14.2: Capture fixtures**

Easiest path: open `https://i.instagram.com/api/v1/users/web_profile_info/?username=instagram` in a logged-in Chrome, copy the JSON response into `packages/extension/tests/fixtures/web_profile_info.json`. Repeat for `feed/user` (needs a numeric user id) and `web/search/topsearch/?query=test`. Anonymise PII (replace usernames, IDs, captions with safe placeholders) before committing.

- [ ] **Step 14.3: Tests**

`packages/extension/tests/parsers.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseWebProfileInfo, parseFeedUser, parseTopsearch } from '../src/content/parsers.js'

function fx(name: string): unknown {
  return JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8'))
}

describe('parsers', () => {
  it('parseWebProfileInfo extracts ProfileData', () => {
    const profile = parseWebProfileInfo(fx('web_profile_info.json'))
    expect(profile.username).toBe('instagram')
    expect(profile.followers).toBeGreaterThan(0)
    expect(profile.postsCount).toBeGreaterThanOrEqual(0)
  })

  it('parseFeedUser extracts PostData[]', () => {
    const posts = parseFeedUser(fx('feed_user.json'))
    expect(Array.isArray(posts)).toBe(true)
    expect(posts.length).toBeGreaterThan(0)
    for (const p of posts) {
      expect(p.postUrl).toMatch(/^https:\/\/www\.instagram\.com\//)
      expect(typeof p.likes === 'number' || p.likes === undefined).toBe(true)
    }
  })

  it('parseTopsearch extracts DiscoveredCandidate[]', () => {
    const cands = parseTopsearch(fx('topsearch.json'))
    expect(Array.isArray(cands)).toBe(true)
    expect(cands.length).toBeGreaterThan(0)
    for (const c of cands) expect(typeof c.username).toBe('string')
  })
})
```

- [ ] **Step 14.4: Run**

```bash
pnpm --filter @anubis/extension test
```

Expected: green. If fixtures don't match the expected fields, adjust the fixture or the parser — but stay faithful to the live shape.

- [ ] **Step 14.5: Commit**

```bash
git add packages/extension/src/content/parsers.ts packages/extension/tests/parsers.test.ts packages/extension/tests/fixtures
git commit -m "feat(extension/parsers): port IG response parsers + golden fixtures"
```

---

## Task 15: Content script — `capture-profile`

**Files:**
- Modify: `packages/extension/src/content/instagram.ts`

- [ ] **Step 15.1: Replace `instagram.ts`**

```ts
import { parseWebProfileInfo, parseFeedUser } from './parsers.js'

interface ExecMessage {
  type: 'execute'
  jobId: string
  kind: 'capture-profile' | 'discover'
  input: { username?: string; maxResponses?: number; source?: 'explore' | 'hashtag' | 'keyword'; hashtag?: string; keyword?: string; targetCompetitors?: number }
}

// Wait until the page is fully loaded before announcing readiness —
// IG mounts its app shell over a couple of frames, and an early
// `ready` would have us fire fetches before cookies/headers are
// finalised.
function whenReady(): Promise<void> {
  if (document.readyState === 'complete') return Promise.resolve()
  return new Promise((resolve) => window.addEventListener('load', () => resolve(), { once: true }))
}

void whenReady().then(() => {
  chrome.runtime.sendMessage({ type: 'ready' })
})

chrome.runtime.onMessage.addListener((msg: ExecMessage, _sender, sendResponse) => {
  if (msg?.type !== 'execute') return
  void run(msg).catch((e) => {
    chrome.runtime.sendMessage({
      type: 'error',
      jobId: msg.jobId,
      code: 'CONTENT_THROW',
      message: e instanceof Error ? e.message : 'unknown content-script error',
    })
  })
  sendResponse({ ok: true })
  return true
})

async function run(msg: ExecMessage): Promise<void> {
  if (msg.kind === 'capture-profile') {
    const username = msg.input.username?.trim()
    if (!username) throw new Error('username required')
    const maxResponses = msg.input.maxResponses ?? 30

    const profileJson = await sameOriginFetch(`/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`)
    const profile = parseWebProfileInfo(profileJson)
    const userId = extractUserId(profileJson)
    if (!userId) throw new Error(`Could not extract user id for @${username}`)

    const feedJson = await sameOriginFetch(`/api/v1/feed/user/${encodeURIComponent(userId)}/?count=${maxResponses}`)
    const posts = parseFeedUser(feedJson)

    chrome.runtime.sendMessage({
      type: 'result',
      jobId: msg.jobId,
      data: { profiles: [profile], posts },
    })
    return
  }
  // discover handled in Task 17
}

async function sameOriginFetch(path: string): Promise<unknown> {
  // `i.instagram.com` is the documented API host; the web origin
  // proxies through fine. Use the web origin so we never have to
  // think about CORS.
  const res = await fetch(`https://www.instagram.com${path}`, {
    credentials: 'include',
    headers: {
      'X-IG-App-ID': '936619743392459',          // Web client id, stable for years
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': 'application/json',
    },
  })
  if (!res.ok) throw new Error(`IG returned ${res.status} for ${path}`)
  return res.json()
}

function extractUserId(profileJson: unknown): string | null {
  const j = profileJson as { data?: { user?: { id?: string; pk?: string } } }
  return j.data?.user?.id ?? j.data?.user?.pk ?? null
}
```

- [ ] **Step 15.2: Build, reload extension, re-run smoke**

```bash
pnpm --filter @anubis/extension build
```

In `chrome://extensions` click the reload arrow next to Anubis. Re-run the manual dispatch from Task 13.4 (re-add the debug route briefly if you removed it) for `username: 'instagram'`. Expected: backend receives a `result` with `{ profiles: [...], posts: [...] }`.

- [ ] **Step 15.3: Commit**

```bash
git add packages/extension/src/content/instagram.ts
git commit -m "feat(extension/content): capture-profile via IG web/feed APIs"
```

---

## Task 16: Wire `POST /captures/competitors/:id` (login) → extension dispatch

**Files:**
- Modify: `packages/backend/src/captures.ts`
- Create: `packages/backend/tests/captures-via-extension.test.ts`
- Delete: `packages/backend/tests/crawler-config-merge.test.ts` (replaced by the new test in Task 18 or 20)

- [ ] **Step 16.1: Update `captures.ts`**

Replace the whole `captureRoutes.post('/competitors/:id', ...)` body. The new shape:

```ts
captureRoutes.post('/competitors/:id', async (c) => {
  const stack = getStack()
  const competitor = stack.competitors.get(c.req.param('id'))
  if (!competitor) return c.json({ ok: false, error: 'not_found' }, 404)

  const body = CaptureBody.parse(await c.req.json().catch(() => ({})))
  const usernameNoAt = competitor.handle.replace(/^@/, '')
  const selectedProfile = body.profile ?? 'public'

  // For the login profile we dispatch to the extension. Public/Flow
  // keep using the existing CDP scraper.
  let result: StandardCrawlerOutput
  if (selectedProfile === 'login') {
    await ensureExtensionStarted()
    const queue = getJobQueue()
    if (!queue) return c.json({ ok: false, error: { code: 'EXTENSION_OFFLINE', message: 'Extension queue not ready.' } }, 503)
    try {
      const data = await queue.dispatch({
        kind: 'capture-profile',
        input: { username: usernameNoAt, maxResponses: body.maxResponses ?? 30 },
        timeoutMs: body.timeoutMs ?? 90_000,
      }) as { profiles: ProfileData[]; posts: PostData[] }
      result = synthStandardOutput(data, usernameNoAt)
    } catch (e) {
      return mapExtensionError(c, e)
    }
  } else {
    try {
      result = await captureInstagramData({
        username: usernameNoAt,
        profile: selectedProfile,
        chromePath: stack.appConfig.get().chromePath,
        headless: body.headless,
        forceHeadless: body.forceHeadless,
        maxResponses: body.maxResponses ?? 30,
        timeoutMs: body.timeoutMs ?? 90_000,
        reporter: silentReporter(),
      })
    } catch (e) {
      return c.json({ ok: false, error: { code: 'CAPTURE_FAILED', message: e instanceof Error ? e.message : 'Capture threw.' } }, 500)
    }
  }
  // ... rest of the existing route body (persist posts, refresh stats) is unchanged
})
```

Add the imports at the top:

```ts
import { ensureExtensionStarted, getJobQueue } from './services.js'
import { ExtensionDispatchError, EXTENSION_OFFLINE, EXTENSION_TIMEOUT, EXTENSION_ERROR, CANCELLED } from './extension/job-queue.js'
import { computeAvgLikes } from '@anubis/research-crawler'   // ⚠️ confirm export; if missing, expose it
```

Add the helpers (at the bottom of the file):

```ts
function synthStandardOutput(
  data: { profiles: ProfileData[]; posts: PostData[] },
  username: string,
): StandardCrawlerOutput {
  // Mirror the shape captureInstagramData returns so downstream
  // persistence code works unchanged. avgLikes is computed via the
  // same dominant-cluster-mean we always used.
  const avgLikes = computeAvgLikes(data.posts)
  return {
    ok: true,
    schemaVersion: '1.0',
    output: { profiles: data.profiles, posts: data.posts },
    meta: {
      profileCount: data.profiles.length,
      postCount: data.posts.length,
      warnings: [],
      avgLikes: { perProfile: [{ username, avgLikes }] },
    },
  }
}

function mapExtensionError(c: Parameters<typeof captureRoutes.post>[1] extends (ctx: infer Ctx, ...args: any[]) => any ? Ctx : never, e: unknown) {
  if (e instanceof ExtensionDispatchError) {
    const status = e.code === EXTENSION_OFFLINE ? 503
                 : e.code === EXTENSION_TIMEOUT ? 504
                 : e.code === CANCELLED ? 499
                 : 500
    return c.json({ ok: false, error: { code: e.code, message: e.message } }, status)
  }
  return c.json({ ok: false, error: { code: 'CAPTURE_FAILED', message: e instanceof Error ? e.message : 'unknown' } }, 500)
}
```

⚠️ If `computeAvgLikes` isn't currently exported from `@anubis/research-crawler`, expose it: open `packages/research-crawler/src/index.ts` (or wherever the package root exports live), find the dominant-cluster-mean implementation, and re-export it:

```ts
export { computeAvgLikes } from './core/instagram/avg-likes.js'
```

(File name guess — search the package if needed.)

- [ ] **Step 16.2: Test**

`packages/backend/tests/captures-via-extension.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Mock JobQueue: any dispatch resolves with canned data.
vi.mock('../src/extension/job-queue.js', async () => {
  const actual = await vi.importActual<typeof import('../src/extension/job-queue.js')>('../src/extension/job-queue.js')
  return {
    ...actual,
    JobQueue: class FakeQueue {
      dispatch(_opts: unknown): Promise<unknown> {
        return Promise.resolve({
          profiles: [{ username: 'falah.isnan', followers: 1234, postsCount: 50 }],
          posts: [
            { postUrl: 'https://www.instagram.com/p/abc/', likes: 100, comments: 5, timestamp: '2026-01-01T00:00:00Z' },
            { postUrl: 'https://www.instagram.com/p/def/', likes: 110, comments: 7, timestamp: '2026-01-02T00:00:00Z' },
          ],
        })
      }
    },
  }
})

// Stub services.ts to return the fake queue.
vi.mock('../src/services.js', async () => {
  const actual = await vi.importActual<typeof import('../src/services.js')>('../src/services.js')
  return {
    ...actual,
    ensureExtensionStarted: async () => undefined,
    getJobQueue: () => ({ dispatch: () => Promise.resolve({
      profiles: [{ username: 'falah.isnan', followers: 1234, postsCount: 50 }],
      posts: [
        { postUrl: 'https://www.instagram.com/p/abc/', likes: 100, comments: 5, timestamp: '2026-01-01T00:00:00Z' },
        { postUrl: 'https://www.instagram.com/p/def/', likes: 110, comments: 7, timestamp: '2026-01-02T00:00:00Z' },
      ],
    }) }),
  }
})

let dataDir: string

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'anubis-cap-ext-'))
  process.env.ANUBIS_DATA_DIR = dataDir
  const { getStack } = await import('../src/services.js')
  getStack().competitors.create({ handle: 'falah.isnan' })
})

afterAll(async () => {
  const { shutdownStack } = await import('../src/services.js')
  await shutdownStack()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('POST /captures/competitors/:id with profile=login dispatches via extension', () => {
  it('persists returned posts and updates competitor stats', async () => {
    const { default: app } = await import('../src/app.js')
    const { getStack } = await import('../src/services.js')
    const id = getStack().competitors.list()[0]!.id
    const res = await app.request(`/captures/competitors/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profile: 'login' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; capturedCount: number; competitor: { followers?: number } }
    expect(body.ok).toBe(true)
    expect(body.capturedCount).toBe(2)
    expect(body.competitor.followers).toBe(1234)
    const posts = getStack().capturedPosts.list({ competitorId: id, limit: 10, orderBy: 'recent' })
    expect(posts.length).toBe(2)
  })
})
```

- [ ] **Step 16.3: Delete the obsolete test**

```bash
rm packages/backend/tests/crawler-config-merge.test.ts
```

- [ ] **Step 16.4: Run tests**

```bash
pnpm typecheck
pnpm vitest run packages/backend/tests
```

Expected: green. (If avg-likes export was missing, this is where it surfaces — fix per the note in 16.1 and re-run.)

- [ ] **Step 16.5: Commit**

```bash
git add packages/backend/src/captures.ts packages/backend/tests/captures-via-extension.test.ts packages/research-crawler/src/index.ts
git rm packages/backend/tests/crawler-config-merge.test.ts
git commit -m "feat(backend/captures): login captures dispatched via extension"
```

---

## Task 17: Content script — `discover` (all three sources)

**Files:**
- Modify: `packages/extension/src/content/instagram.ts`

- [ ] **Step 17.1: Extend `run()`** — add the discover branch after the existing capture-profile branch:

```ts
if (msg.kind === 'discover') {
  const { source, hashtag, keyword, targetCompetitors = 10 } = msg.input
  let candidates: { username: string; fullName?: string; followers?: number; profileUrl?: string }[] = []

  if (source === 'keyword') {
    if (!keyword) throw new Error('keyword required')
    const json = await sameOriginFetch(`/web/search/topsearch/?query=${encodeURIComponent(keyword)}`)
    candidates = parseTopsearch(json).slice(0, targetCompetitors)
  } else if (source === 'hashtag') {
    if (!hashtag) throw new Error('hashtag required')
    // The hashtag page emits a GraphQL response we intercept by
    // re-fetching the internal endpoint directly.
    const json = await sameOriginFetch(`/api/v1/tags/web_info/?tag_name=${encodeURIComponent(hashtag)}`)
    candidates = parseHashtagWebInfo(json).slice(0, targetCompetitors)
  } else {
    // explore: simplest robust source is topsearch with no query =>
    // doesn't work. Instead, scrape /api/v1/discover/web/explore_grid/.
    const json = await sameOriginFetch(`/api/v1/discover/web/explore_grid/?is_prefetch=false&omit_cover_media=true`)
    candidates = parseExploreGrid(json).slice(0, targetCompetitors)
  }

  chrome.runtime.sendMessage({
    type: 'result',
    jobId: msg.jobId,
    data: { profiles: candidates.map((c) => ({
      username: c.username, fullName: c.fullName, followers: c.followers, profileUrl: c.profileUrl,
    })), posts: [] },
  })
  return
}
```

Add imports:

```ts
import { parseWebProfileInfo, parseFeedUser, parseTopsearch, parseHashtagWebInfo, parseExploreGrid } from './parsers.js'
```

- [ ] **Step 17.2: Implement `parseHashtagWebInfo` + `parseExploreGrid` in `parsers.ts`**

Port from the existing CDP scraper's discover code. Both return `DiscoveredCandidate[]`. Add golden fixtures + tests in `parsers.test.ts` for each (same pattern as Task 14).

- [ ] **Step 17.3: Tests**

Extend `parsers.test.ts`:

```ts
it('parseHashtagWebInfo extracts DiscoveredCandidate[]', () => {
  const cands = parseHashtagWebInfo(fx('hashtag_web_info.json'))
  expect(Array.isArray(cands)).toBe(true)
})
it('parseExploreGrid extracts DiscoveredCandidate[]', () => {
  const cands = parseExploreGrid(fx('explore_grid.json'))
  expect(Array.isArray(cands)).toBe(true)
})
```

- [ ] **Step 17.4: Build + smoke**

Reload extension. Re-run the manual debug dispatch from Task 13 with `kind: 'discover'`, `input: { source: 'keyword', keyword: 'coffee', targetCompetitors: 5 }`. Expected: a list of profiles comes back.

- [ ] **Step 17.5: Commit**

```bash
git add packages/extension/src/content/instagram.ts packages/extension/src/content/parsers.ts packages/extension/tests/fixtures packages/extension/tests/parsers.test.ts
git commit -m "feat(extension/content): discover via topsearch/hashtag/explore_grid"
```

---

## Task 18: Wire `POST /research-crawler/instagram/discover` + `capture-profile` (login) → extension

**Files:**
- Modify: `packages/backend/src/research-crawler.ts`
- Create: `packages/backend/tests/discover-via-extension.test.ts`

- [ ] **Step 18.1: Update `research-crawler.ts`**

For each of the three routes (`/chrome/open`, `/instagram/capture-profile`, `/instagram/discover`), preserve `public`/`flow` behaviour. For `profile === 'login'`:

- `/chrome/open` → return 400 with `{ code: 'NOT_APPLICABLE_FOR_LOGIN', message: 'Login captures use the Anubis extension; no Chrome to open here.' }`
- `/instagram/capture-profile` → dispatch a `capture-profile` job
- `/instagram/discover` → dispatch a `discover` job

Concretely for discover:

```ts
researchCrawlerRoutes.post('/instagram/discover', async (c) => {
  const input = discoverInstagramSchema.parse(await c.req.json())
  if (input.profile === 'login') {
    await ensureExtensionStarted()
    const queue = getJobQueue()
    if (!queue) return c.json({ ok: false, error: { code: 'EXTENSION_OFFLINE', message: 'Extension queue not ready.' } }, 503)
    try {
      const data = await queue.dispatch({
        kind: 'discover',
        input: { source: input.source ?? 'explore', hashtag: input.hashtag, keyword: input.keyword, targetCompetitors: input.targetCompetitors ?? 10 },
        timeoutMs: input.timeoutMs ?? 60_000,
      }) as { profiles: unknown[]; posts: unknown[] }
      return c.json({
        ok: true,
        schemaVersion: '1.0',
        output: { profiles: data.profiles, posts: data.posts },
        meta: { profileCount: data.profiles.length, postCount: data.posts.length, warnings: [] },
      })
    } catch (e) {
      return mapExtensionError(c, e)
    }
  }
  // public/flow: existing path
  return c.json(await discoverInstagramCompetitors({ ...input, chromePath: getStack().appConfig.get().chromePath, reporter: silentReporter() }))
})
```

Apply the same pattern to `/instagram/capture-profile`. Drop all the `withOverrides` + `configOverrides` + `ensureFreshLoginChrome` logic — it's no longer needed for `login` and is irrelevant for `public`/`flow`. The chromePath override stays but flows through a single `getStack().appConfig.get().chromePath`.

Move `mapExtensionError` to a small new file so both routes can import it: `packages/backend/src/extension/error-mapping.ts`. Export and import in both `captures.ts` and `research-crawler.ts`.

- [ ] **Step 18.2: Test**

`packages/backend/tests/discover-via-extension.test.ts` (same `vi.mock` shape as `captures-via-extension.test.ts`):

```ts
// ...same vi.mock for services.js with a fake queue that resolves
// { profiles: [...], posts: [] } for kind: 'discover'

describe('POST /research-crawler/instagram/discover with profile=login dispatches via extension', () => {
  it('returns the dispatched profiles in StandardCrawlerOutput shape', async () => {
    const { default: app } = await import('../src/app.js')
    const res = await app.request('/research-crawler/instagram/discover', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'keyword', keyword: 'coffee', profile: 'login', targetCompetitors: 5 }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; output: { profiles: unknown[] } }
    expect(body.ok).toBe(true)
    expect(body.output.profiles.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 18.3: Run tests + typecheck**

```bash
pnpm typecheck
pnpm vitest run packages/backend/tests
```

Expected: green.

- [ ] **Step 18.4: Commit**

```bash
git add packages/backend/src/research-crawler.ts packages/backend/src/extension/error-mapping.ts packages/backend/src/captures.ts packages/backend/tests/discover-via-extension.test.ts
git commit -m "feat(backend/research-crawler): login discover + capture-profile via extension"
```

---

## Task 19: Settings UI — Chrome extension section

**Files:**
- Modify: `packages/frontend/src/api.ts`
- Modify: `packages/frontend/src/pages/settings.tsx`

- [ ] **Step 19.1: Add API helpers in `api.ts`**

```ts
export interface ExtensionStatus {
  connected: boolean
  extensionVersion?: string
  pairedAt?: number
  port: number
  dataDirPath: string
}

export async function getExtensionStatus(): Promise<ExtensionStatus> {
  const r = await api<{ ok: true; status: ExtensionStatus }>('/extension/status')
  return r.status
}

export async function revealExtensionSecret(): Promise<string> {
  const r = await api<{ ok: true; secret: string }>('/extension/secret/reveal', { method: 'POST' })
  return r.secret
}

export async function rotateExtensionSecret(): Promise<string> {
  const r = await api<{ ok: true; secret: string }>('/extension/secret/rotate', { method: 'POST' })
  return r.secret
}
```

Drop the `cloneChromeProfile` / `listLocalChromeProfiles` / `CloneChromeProfileResult` helpers — they're dead.

- [ ] **Step 19.2: Rewrite `packages/frontend/src/pages/settings.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { CheckCircle2Icon, EyeIcon, EyeOffIcon, RefreshCwIcon, RotateCcwIcon, SaveIcon } from 'lucide-react'
import type { AppConfig } from '@anubis/shared'
import {
  getAppConfig,
  updateAppConfig,
  getExtensionStatus,
  revealExtensionSecret,
  rotateExtensionSecret,
  type ExtensionStatus,
} from '@/api'
import { cn } from '@/lib/utils'

type Banner = { kind: 'success' | 'error'; message: string }

export function SettingsPage() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [form, setForm] = useState<AppConfig>({})
  const [status, setStatus] = useState<ExtensionStatus | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [secretRevealed, setSecretRevealed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState<Banner | null>(null)

  useEffect(() => {
    let alive = true
    void Promise.all([getAppConfig(), getExtensionStatus()]).then(([cfg, s]) => {
      if (!alive) return
      setConfig(cfg); setForm(cfg); setStatus(s)
    })
    const id = window.setInterval(async () => {
      if (!alive) return
      try { setStatus(await getExtensionStatus()) } catch { /* swallow */ }
    }, 2000)
    return () => { alive = false; window.clearInterval(id) }
  }, [])

  const chromePathDirty = (form.chromePath ?? '') !== (config?.chromePath ?? '')

  async function handleSave() {
    setBusy(true); setBanner(null)
    try {
      const next = await updateAppConfig({ chromePath: form.chromePath ?? '' })
      setConfig(next); setForm((f) => ({ ...f, chromePath: next.chromePath ?? '' }))
      setBanner({ kind: 'success', message: 'Saved.' })
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Could not save.' })
    } finally {
      setBusy(false)
    }
  }

  async function handleReveal() {
    if (secretRevealed) { setSecretRevealed(false); return }
    try {
      const s = await revealExtensionSecret()
      setSecret(s); setSecretRevealed(true)
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Could not reveal secret.' })
    }
  }

  async function handleRotate() {
    if (!window.confirm('Rotate the pairing secret? The extension will disconnect until you paste the new value into its Options page.')) return
    try {
      const s = await rotateExtensionSecret()
      setSecret(s); setSecretRevealed(true)
      setBanner({ kind: 'success', message: 'Secret rotated. Paste the new value into the extension Options page.' })
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Rotate failed.' })
    }
  }

  async function copyToClipboard(value: string) {
    try { await navigator.clipboard.writeText(value); setBanner({ kind: 'success', message: 'Copied.' }) } catch { /* swallow */ }
  }

  if (!config || !status) return <div className='p-6'>Loading…</div>

  const dot = status.connected ? 'bg-green-500' : 'bg-amber-500'
  return (
    <div className='flex flex-1 flex-col overflow-y-auto bg-background'>
      <div className='mx-auto w-full max-w-[860px] px-7 pb-16'>
        <div className='flex flex-col gap-4 pt-7'>
          <div className='flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between'>
            <div>
              <h1 className='text-[28px] font-semibold leading-[1.1] tracking-[-0.025em]'>Settings</h1>
              <p className='mt-1.5 max-w-xl text-[13.5px] leading-relaxed text-muted-foreground'>
                Per-machine knobs. Saved to <code className='font-mono text-foreground/80'>config.json</code> next to the database.
              </p>
            </div>
            <button
              type='button'
              onClick={() => void handleSave()}
              disabled={!chromePathDirty || busy}
              className={cn('inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-[13.5px] font-semibold transition-colors',
                !chromePathDirty || busy
                  ? 'cursor-not-allowed bg-[var(--anubis-gold)] text-[#0B0C0F] opacity-50'
                  : 'bg-[var(--anubis-gold)] text-[#0B0C0F] hover:bg-[var(--anubis-gold-deep)]')}
            >
              <SaveIcon className='size-[15px]' strokeWidth={2} />
              {busy ? 'Saving…' : chromePathDirty ? 'Save changes' : 'Saved'}
            </button>
          </div>
        </div>

        {banner && (
          <div role='status' className={cn(
            'mt-5 rounded-md border px-3.5 py-2.5 text-[13px]',
            banner.kind === 'error'
              ? 'border-destructive/40 bg-destructive/10 text-destructive'
              : 'border-[var(--anubis-gold)]/40 bg-[var(--anubis-gold)]/10 text-foreground',
          )}>
            {banner.message}
          </div>
        )}

        <section className='mt-8 border-t border-border pt-6'>
          <h2 className='font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>
            Research-crawler · Chrome extension
          </h2>
          <p className='mt-1 text-[12.5px] leading-relaxed text-muted-foreground'>
            Logged-in Instagram captures run inside your real Chrome session via the Anubis extension. The desktop app dispatches jobs to the extension over a localhost WebSocket.
          </p>
          <div className='mt-4 flex items-center gap-2 rounded-md border border-border bg-card p-3'>
            <span className={cn('h-2 w-2 rounded-full', dot)} aria-hidden />
            <span className='text-[13.5px] font-medium'>
              {status.connected ? `Connected — extension v${status.extensionVersion ?? '?'}` : 'Offline'}
            </span>
            {status.connected && (
              <CheckCircle2Icon className='ml-1 size-3.5 text-[var(--anubis-gold)]' strokeWidth={2} />
            )}
          </div>
          <div className='mt-3 flex flex-col gap-2'>
            <div className='flex gap-2'>
              <button type='button' onClick={() => void handleReveal()}
                className='inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-[12.5px] hover:bg-muted'>
                {secretRevealed ? <EyeOffIcon className='size-3.5' /> : <EyeIcon className='size-3.5' />}
                {secretRevealed ? 'Hide pairing secret' : 'Reveal pairing secret'}
              </button>
              <button type='button' onClick={() => void handleRotate()}
                className='inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-[12.5px] hover:bg-muted'>
                <RotateCcwIcon className='size-3.5' /> Re-generate secret
              </button>
            </div>
            {secretRevealed && secret && (
              <div className='flex flex-col gap-1 rounded-md border border-border bg-card p-3 font-mono text-[12px]'>
                <code className='break-all'>{secret}</code>
                <button type='button' onClick={() => void copyToClipboard(secret)} className='self-start text-[11.5px] text-[var(--anubis-gold)] hover:underline'>
                  Copy to clipboard
                </button>
              </div>
            )}
            <ol className='mt-2 ml-5 list-decimal text-[12.5px] leading-relaxed text-muted-foreground'>
              <li>Open <code className='font-mono'>chrome://extensions</code> in Chrome.</li>
              <li>Toggle <strong>Developer mode</strong> (top-right).</li>
              <li>Click <strong>Load unpacked</strong> → pick <code className='font-mono text-foreground/80'>{status.dataDirPath}</code>.</li>
              <li>Click the Anubis icon → <strong>Options</strong> → paste the secret above.</li>
            </ol>
          </div>
        </section>

        <section className='mt-8 border-t border-border pt-6'>
          <h2 className='font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>Chrome executable path</h2>
          <p className='mt-1 text-[12.5px] leading-relaxed text-muted-foreground'>
            Optional. Only set this if Chrome isn’t on PATH.
          </p>
          <input
            type='text'
            value={form.chromePath ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, chromePath: e.target.value }))}
            placeholder='C:\Program Files\Google\Chrome\Application\chrome.exe'
            spellCheck={false}
            className='mt-3 h-10 w-full rounded-md border border-border bg-card px-3 font-mono text-[12.5px] text-foreground outline-none focus:border-[var(--anubis-gold)]/50'
          />
        </section>
      </div>
    </div>
  )
}
```

- [ ] **Step 19.3: Typecheck + visual sanity**

```bash
pnpm --filter @anubis/frontend typecheck
pnpm dev      # then open Settings in the app
```

Expected: page renders, status pill updates as you toggle the extension's connection.

- [ ] **Step 19.4: Commit**

```bash
git add packages/frontend/src/api.ts packages/frontend/src/pages/settings.tsx
git commit -m "feat(frontend/settings): replace Chrome profile picker with extension pairing UI"
```

---

## Task 20: Delete legacy login-profile plumbing

**Files:**
- Delete: `packages/backend/src/chrome-guard.ts`
- Modify: `packages/backend/src/captures.ts` (drop `ensureFreshLoginChrome` import)
- Modify: `packages/backend/src/research-crawler.ts` (drop `ensureFreshLoginChrome` import + any leftover split-path code)
- Modify: `packages/backend/src/system.ts` (remove `GET /chrome-profiles` route + helpers — the Settings page no longer enumerates them)
- Modify: `packages/research-crawler/src/core/chrome/launch-chrome.ts` — strip the `profileDirectory` parameter we added in `ad0b52d` (it's no longer used by anyone in `profile === 'login'` flow). The CDP-driven `public`/`flow` profiles never had a use for it.

- [ ] **Step 20.1: Audit references**

```bash
git grep ensureFreshLoginChrome packages/
git grep splitProfilePath packages/
git grep loginProfileDir packages/
git grep ChromeProfileInfo packages/
git grep chrome-profiles packages/
```

Confirm the only references are in files we're about to modify or delete.

- [ ] **Step 20.2: Delete + edit**

```bash
rm packages/backend/src/chrome-guard.ts
```

Strip the imports + call sites from `captures.ts` and `research-crawler.ts`. In `system.ts`, leave the file's framework but reduce it to whatever still has value (e.g. nothing IG-related; if everything is dead, delete the route mount in `app.ts` and delete the file). In `launch-chrome.ts`, remove the `profileDirectory` field from `LaunchChromeInput` + the arg-push that uses it.

- [ ] **Step 20.3: Typecheck + run all tests**

```bash
pnpm typecheck
pnpm vitest run
```

Expected: green across the board.

- [ ] **Step 20.4: Commit**

```bash
git add -A
git commit -m "chore(backend): delete login-profile CDP plumbing (chrome-guard, profile picker, splitProfilePath)"
```

---

## Task 21: Electron — bundle extension + IPC for "Open extension folder"

**Files:**
- Modify: `apps/desktop/electron-builder.json` (or wherever extraResources is configured) — include `packages/extension/dist` as a resource
- Modify: `apps/desktop/electron/main/backend.ts` — pass `ANUBIS_EXTENSION_BUNDLE_DIR` env var to the spawned backend, pointing at the packaged resources path in production and the dev path in development
- Modify: `apps/desktop/electron/main/index.ts` or wherever IPC handlers live — add `anubis:open-extension-folder` handler that calls `shell.openPath`
- Modify: `apps/desktop/electron/preload/index.ts` — expose `window.anubis.openExtensionFolder()`
- Modify: `packages/frontend/src/pages/settings.tsx` — add an "Open extension folder" button that uses it

- [ ] **Step 21.1: Find existing patterns**

```bash
git grep extraResources apps/desktop
git grep shell\.openPath apps/desktop
git grep anubis:get-backend-url apps/desktop
```

The preload IPC and bundle-resource patterns already exist (see `anubis:get-backend-url` per `CLAUDE.md`). Copy the shape.

- [ ] **Step 21.2: extraResources in `electron-builder.json`**

Add an entry like:

```json
{ "from": "packages/extension/dist", "to": "extension" }
```

- [ ] **Step 21.3: Set `ANUBIS_EXTENSION_BUNDLE_DIR`**

In `apps/desktop/electron/main/backend.ts`, where the backend is spawned, compute:

```ts
import { app } from 'electron'
import { join } from 'node:path'

const extensionBundleDir = app.isPackaged
  ? join(process.resourcesPath, 'extension')
  : join(__dirname, '..', '..', '..', '..', '..', 'packages', 'extension', 'dist')
```

Pass to the spawn env: `env: { ...process.env, ANUBIS_BACKEND_PORT: '0', ANUBIS_EXTENSION_BUNDLE_DIR: extensionBundleDir }`.

- [ ] **Step 21.4: IPC**

In the Electron main `index.ts`:

```ts
import { ipcMain, shell } from 'electron'
ipcMain.handle('anubis:open-extension-folder', (_e, path: string) => shell.openPath(path))
```

In preload:

```ts
contextBridge.exposeInMainWorld('anubis', {
  // ... existing bridges
  openExtensionFolder: (path: string) => ipcRenderer.invoke('anubis:open-extension-folder', path),
})
```

Update the type augmentation at `packages/frontend/src/anubis-window.d.ts` (or wherever the global `window.anubis` interface lives) to include `openExtensionFolder(path: string): Promise<string>`.

- [ ] **Step 21.5: Wire button in Settings**

Just above the install instructions in `settings.tsx`:

```tsx
<button
  type='button'
  onClick={() => void window.anubis?.openExtensionFolder?.(status.dataDirPath)}
  className='inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-[12.5px] hover:bg-muted'
>
  Open extension folder
</button>
```

- [ ] **Step 21.6: Full build + manual verification**

```bash
pnpm build
```

Run the packaged app. In Settings: Open extension folder opens the folder. Load unpacked from there. Pair. Capture posts on a real competitor. Verify posts persist in the Content page.

- [ ] **Step 21.7: Commit**

```bash
git add apps/desktop apps/desktop/electron-builder.json packages/frontend/src/pages/settings.tsx packages/frontend/src/anubis-window.d.ts
git commit -m "feat(desktop): bundle extension + IPC for openExtensionFolder"
```

---

## Final verification

- [ ] **Step F.1: All tests green** — `pnpm vitest run && pnpm --filter @anubis/frontend test && pnpm --filter @anubis/extension test`
- [ ] **Step F.2: Typecheck clean across all packages** — `pnpm typecheck`
- [ ] **Step F.3: Manual end-to-end** — install extension, pair, Capture posts on a real Instagram competitor, confirm real data lands in the Content page; toggle Chrome off/on and watch the Settings status pill flip.
- [ ] **Step F.4: Squash optional** — the per-task commits document intent well; no squash recommended.

That's it.
