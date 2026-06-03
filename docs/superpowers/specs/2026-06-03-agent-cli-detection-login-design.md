# Agent CLI Detection + Login + Bootstrap + Copy-with-Auth — Design

**Date:** 2026-06-03
**Status:** Approved (brainstorming) — pending implementation plan
**Scope:** `packages/ai-agent`, `packages/conversation`, `packages/backend`, `packages/frontend`, `packages/shared`
**Builds on:** chat-profile-selection (a2e48a8..2a7500c) and the codex-crash hotfix (e4a8c22).

## Problem

After landing the profile/effort pickers, three friction points surfaced when a
user actually tried to chat:

1. Picking a Codex profile without the `codex` CLI installed produced a hard
   backend crash. The hotfix at e4a8c22 stops the crash, but the UI still
   gives users no warning that the CLI is missing.
2. There's no way to authenticate the agent CLI from inside Anubis. First-time
   users have to run `claude` (or `codex login`) themselves in a separate
   terminal, with the right `CLAUDE_CONFIG_DIR` env var set, before the app
   becomes usable.
3. Copying a profile (Profiles → Copy) creates a fresh empty home dir for the
   new profile, forcing the user to re-authenticate even though the source
   was already logged in.

A fourth concern: the built-in `claude-coding` profile has its own isolated
home, so even users who already have a working Claude CLI install have to log
in *again* just to use the default profile.

## Goals

1. **Detect (A)**: Detect whether `claude` and `codex` are on PATH at boot.
   Expose results via the catalog; surface in the picker and composer.
2. **Login (B)**: When a profile lacks credentials, an in-app modal renders
   the interactive CLI inside an xterm.js terminal connected to a backend
   PTY. User completes the OAuth flow; backend watches the home dir for the
   credentials file appearing and closes the modal with success.
3. **Bootstrap (C)**: On boot, if the built-in `claude-coding` profile's home
   is empty *and* `~/.claude/.credentials.json` exists, copy `~/.claude`
   into the profile's home. One-shot, idempotent.
4. **Copy-with-auth (D)**: Profiles → Copy creates the new profile *and*
   recursively copies the source profile's home (auth + MCP + history).
5. The composer auto-prompts the login modal when `sendMessage` rejects with
   a structured `no_credentials` error, and retries the send after a
   successful login.

## Non-goals

- A standalone "Log out" UI per profile. The Profiles page's existing "Reset"
  button (which calls `resetProfileHome`) already covers this.
- A "Log in" entry point in the picker. First cut is auto-prompt only.
  (Discoverability follow-up can add a button next to the "not installed"
  badge.)
- Re-mirroring `~/.claude` after bootstrap. Bootstrap is one-shot. If the
  user later logs out system-wide, the profile's copy survives; if they want
  it cleaned, Reset.
- Detecting *which model tier* the user is logged in for. Just "logged in or
  not" — the CLI handles the rest.
- Cross-profile auth sharing (one shared home that multiple profiles use).
  Each profile keeps its own home, copied or not.
- Login UI polish: no xterm theming beyond defaults, no custom prompt
  rewriting, no animated loading frames.

## Architecture overview

```
Backend
├── ai-agent/service/detect-agents.ts             NEW   one-shot CLI presence check
├── ai-agent/service/ai-agent-service.ts          EDIT  detect on boot, include in catalog
├── conversation/profiles/agent-home.ts           EDIT  + hasCredentials, + copyHomeFrom, + copyProfileHome
├── conversation/profiles/profile-service.ts      EDIT  + copyProfile, + bootstrapDefaultClaudeProfile
├── conversation/conversations/conversation-service.ts  EDIT  sendMessage throws no_credentials
├── conversation/src/index.ts                     EDIT  call bootstrap after seedBuiltins
├── backend/src/profile.ts                        EDIT  + POST /profiles/:id/copy
├── backend/src/login-pty.ts                      NEW   WS PTY relay
└── backend/src/server.ts                         EDIT  register WS upgrade handler

Frontend
├── shared/src/index.ts                           EDIT  AgentAvailability type
├── api.ts                                        EDIT  + copyProfile, + loginWsUrl
├── components/composer/profile-picker.tsx        EDIT  "not installed" badge
├── components/login-modal.tsx                    NEW   xterm.js modal
├── pages/active-conversation.tsx                 EDIT  auto-prompt on no_credentials
└── pages/profiles.tsx                            EDIT  Copy uses new endpoint
```

## A — CLI auto-detection

### Detection

`packages/ai-agent/src/service/detect-agents.ts`:

```ts
import { spawnSync } from 'node:child_process'
import { platform } from 'node:os'

export interface AgentAvailability {
  available: boolean
  path?: string
  /** When `available` is true and `path` is missing, the user supplied a
   *  command via env var; we trust them without re-checking the path. */
  source: 'detected' | 'env-override'
}

const lookupCmd = platform() === 'win32' ? 'where.exe' : 'which'

function lookup(binary: string): AgentAvailability {
  try {
    const r = spawnSync(lookupCmd, [binary], { encoding: 'utf8', timeout: 2000 })
    if (r.status === 0 && r.stdout.trim()) {
      const path = r.stdout.split(/\r?\n/)[0]!.trim()
      return { available: true, path, source: 'detected' }
    }
  } catch { /* swallow */ }
  return { available: false, source: 'detected' }
}

export function detectAgents(): Record<'claude' | 'codex', AgentAvailability> {
  const claudeCmd = process.env.ANUBIS_CLAUDE_COMMAND
  const codexCmd = process.env.ANUBIS_CODEX_COMMAND
  return {
    claude: claudeCmd
      ? { available: true, path: claudeCmd, source: 'env-override' }
      : lookup('claude'),
    codex: codexCmd
      ? { available: true, path: codexCmd, source: 'env-override' }
      : lookup('codex'),
  }
}
```

Called once by `AiAgentService` constructor; result cached in a private
`#availability` field. The catalog endpoint includes it.

### Catalog wire format

`packages/shared/src/index.ts` gains:

```ts
export interface AgentAvailability {
  available: boolean
  path?: string
  source: 'detected' | 'env-override'
}
```

`AgentCatalog` (in `packages/frontend/src/api.ts`) gains:

```ts
agentAvailability: Record<'claude' | 'codex', AgentAvailability>
```

### UI surface

- **ProfilePicker**: profiles whose `availability[profile.config.agent].available === false`
  render with `opacity-60`, and a small `<span>not installed</span>` chip in
  place of the model name. Still selectable; we don't fight the user.
- **Composer**: if `availability[selectedProfile.config.agent].available === false`,
  Send is disabled with `title="claude not found on PATH — install Claude CLI first"`.
  An inline strip above the composer reads
  *"`claude` not found on PATH. [Install Claude Code →](https://docs.anthropic.com/claude-code)"*.
  Hides when the agent is available again.

## B — Login modal

### Flow

1. User clicks Send. `sendMessage` POST → backend resolves the profile, calls
   `requireCredentials(profile)`. If the profile's home dir lacks the
   credentials marker:
   ```ts
   throw new ConversationError('no_credentials', { profileId, agent })
   ```
   Hono error handler in `app.ts` returns 409:
   ```json
   { "ok": false, "error": { "code": "no_credentials", "profileId": "claude-coding", "agent": "claude" } }
   ```
2. Frontend's `sendMessage` parses the error and throws a typed
   `NoCredentialsError`. The composer catches it and opens `<LoginModal>`
   with `profileId` and `agent`.
3. `<LoginModal>` opens a WebSocket to `/profiles/:id/login`. Backend route
   accepts upgrade, spawns the PTY, pipes stdin/stdout.
4. User completes OAuth in the browser the CLI opens. CLI exits cleanly,
   credentials file appears in the profile home.
5. Backend's `fs.watch` on the home dir sees the credentials file, sends
   `{ type: 'logged-in' }` over the WS, then closes the connection and the
   PTY (if still running).
6. Modal closes, parent retries the failed `sendMessage`.

### Credential markers

```ts
const CREDENTIAL_FILE: Record<'claude' | 'codex', string> = {
  claude: '.credentials.json',  // path within CLAUDE_CONFIG_DIR
  codex:  'auth.json',          // path within CODEX_HOME
}

export function hasCredentials(
  profileId: string, agent: 'claude' | 'codex',
  agentHomeRoot: string,
): boolean {
  const home = homePathFor(profileId, agent, agentHomeRoot)
  return existsSync(join(home, CREDENTIAL_FILE[agent]))
}
```

The exact filenames may shift in future CLI versions. Encapsulated in this
one constant; if a CLI bumps the filename, change here.

### PTY backend route

`packages/backend/src/login-pty.ts`:

```ts
import { upgradeWebSocket } from '@hono/node-ws'
import { watch } from 'node:fs'
import * as pty from 'node-pty'
import { getStack } from './services.js'

export function registerLoginPty(app: Hono) {
  app.get('/profiles/:id/login', upgradeWebSocket((c) => {
    const profileId = c.req.param('id')
    const stack = getStack()
    const profile = stack.profiles.get(profileId)
    if (!profile) return { onOpen(_, ws) { ws.close(1011, 'profile not found') } }

    const agent = profile.config.agent  // 'claude' | 'codex'
    const homePath = stack.agentHome.ensure(profileId, agent).path
    const env = { ...process.env, ...envFor(agent, homePath) }
    const command = agent === 'claude' ? 'claude' : 'codex'
    const args = agent === 'codex' ? ['login'] : []

    let proc: pty.IPty | null = null
    let watcher: ReturnType<typeof watch> | null = null

    return {
      onOpen(_, ws) {
        try {
          proc = pty.spawn(command, args, {
            name: 'xterm-256color',
            cols: 100, rows: 30,
            cwd: homePath, env,
          })
          proc.onData((chunk) => ws.send(JSON.stringify({ type: 'data', data: chunk })))
          proc.onExit(({ exitCode }) => {
            ws.send(JSON.stringify({ type: 'exited', exitCode }))
            try { ws.close() } catch { /* */ }
          })

          watcher = watch(homePath, { persistent: false }, () => {
            if (hasCredentials(profileId, agent, stack.agentHomeRoot)) {
              ws.send(JSON.stringify({ type: 'logged-in' }))
              try { proc?.kill() } catch { /* */ }
              try { ws.close() } catch { /* */ }
            }
          })
        } catch (e) {
          ws.send(JSON.stringify({ type: 'failed', message: String(e) }))
          ws.close()
        }
      },
      onMessage(evt, ws) {
        try {
          const m = JSON.parse(String(evt.data)) as
            | { type: 'input', data: string }
            | { type: 'resize', cols: number, rows: number }
          if (m.type === 'input') proc?.write(m.data)
          else if (m.type === 'resize') proc?.resize(m.cols, m.rows)
        } catch { /* swallow malformed */ }
      },
      onClose() {
        watcher?.close()
        try { proc?.kill() } catch { /* */ }
      },
    }
  }))
}
```

### Frontend modal

`packages/frontend/src/components/login-modal.tsx` mounts `<Terminal>` from
`xterm` inside a shadcn `<Dialog>`. WebSocket URL comes from
`(await getApiBaseUrl()).replace(/^http/, 'ws') + /profiles/:id/login`.

UI states:
- **Connecting**: "Connecting to login session…" placeholder.
- **Running**: terminal fills the dialog; footer reads "Waiting for login…".
- **Logged in**: green dot + "Logged in" message, auto-close in 1s, fires
  `onSuccess`.
- **Exited / failed**: yellow dot + "Login process exited (code N)" with a
  Close button.

`onSuccess` is the trigger to retry the failed send.

### New deps

- **`node-pty`** (backend) — native binary, requires `electron-rebuild` for
  the packaged Electron build. In dev (`pnpm dev`) the pre-built binaries
  ship with the package, so it Just Works.
- **`@hono/node-ws`** (backend) — WebSocket upgrade helper for Hono.
- **`xterm`** + **`xterm-addon-fit`** (frontend).

## C — Bootstrap default profile from `~/.claude`

After `profiles.seedBuiltins()` runs in
`packages/conversation/src/index.ts`, call:

```ts
profiles.bootstrapDefaultClaudeProfile({
  systemHome: join(homedir(), '.claude'),
  agentHomeRoot,
})
```

`bootstrapDefaultClaudeProfile` walks built-in profiles, picks the one with
`id === 'claude-coding'` (the documented default), and:

1. Computes its profile home (`agentHomeRoot/claude-coding/claude`).
2. If that home exists AND already has `.credentials.json` → skip
   (idempotent — user is set up).
3. Else if `systemHome/.credentials.json` exists → recursive `cp` the entire
   `systemHome` directory into the profile home, preserving file mode.
4. Else → no-op (user has no system Claude install; login modal will run on
   first send).

The recursive copy uses Node 22's `fs.cpSync(src, dst, { recursive: true })`.

### Boot ordering risk

`createConversationService` already does `profiles.seedBuiltins()` early
(before the rest of the stack composes). Adding bootstrap there means it runs
synchronously during composition. Should be fast (a few hundred small files
on Windows), but we run it inside a `try/catch` and log on failure rather
than blocking startup.

## D — Copy profile (with home dir)

### Backend

`packages/conversation/src/profiles/profile-service.ts` gains:

```ts
copyProfile(sourceId: string, input: { name: string; description?: string }): ProfileSummary
```

Behavior:
1. Read source profile via `repo.get(sourceId)`. 404 if missing.
2. Build a new profile body inheriting `source.config` and the passed name/description.
3. Insert the new user profile, returning its id.
4. For the source's agent, `copyHome(sourceProfileId, newProfileId, agent)`
   recursively copies the home dir if the source has one. Missing source
   home is fine (no-op — user gets a fresh login flow on first send).
5. Return the new profile summary.

Wrap steps 3 and 4 in a try/catch — if the home copy throws, roll back the
profile insert (`repo.delete(newId)`) so the user doesn't end up with a
half-copied profile.

### Backend route

`packages/backend/src/profile.ts` gains:

```ts
profileRoutes.post('/:id/copy', async (c) => {
  const body = CopyBody.parse(await c.req.json())
  const created = profiles.copyProfile(c.req.param('id'), body)
  return c.json({ ok: true, profile: created }, 201)
})
```

`CopyBody = z.object({ name: z.string().min(1), description: z.string().optional() }).strict()`

### Frontend wiring

`packages/frontend/src/pages/profiles.tsx` replaces the existing local
`createProfile` call in `handleCopy` with `copyProfile(source.id, ...)` from
`api.ts`. The success banner reads:
*"Copied to «name» — credentials carried over."* (with a softer message when
the source had no home: *"Copied to «name» — you'll need to log in first."*)

## Bootstrap and copy: file-system semantics

| Operation | Source | Destination | If destination exists |
|---|---|---|---|
| Bootstrap | `~/.claude` | `agentHomeRoot/claude-coding/claude` | Skip if `.credentials.json` already there |
| Copy profile | `agentHomeRoot/{src}/{agent}` | `agentHomeRoot/{new}/{agent}` | Should never happen (new id is fresh) — throw |
| Existing Reset | n/a | `agentHomeRoot/{id}/{agent}` | Remove entirely |

All paths anchored to `agentHomeRoot` (already a service dep).

## Error contract for `no_credentials`

Backend `conversation.ts`:

```ts
conversationRoutes.post('/:id/messages', async (c) => {
  const body = SendBody.parse(await c.req.json())
  try {
    const r = await getStack().conversation.sendMessage(c.req.param('id'), body as never)
    return c.json({ ok: true, msgId: r.msgId, messageId: r.messageId }, 202)
  } catch (e) {
    if (e instanceof NoCredentialsError) {
      return c.json(
        { ok: false, error: { code: 'no_credentials', profileId: e.profileId, agent: e.agent } },
        409,
      )
    }
    throw e  // bubbled up to the global handler
  }
})
```

Frontend `api.ts`:

```ts
export class NoCredentialsError extends Error {
  readonly code = 'no_credentials' as const
  constructor(public profileId: string, public agent: 'claude' | 'codex') {
    super(`no credentials for profile ${profileId}`)
  }
}
```

Inside `api<T>()`, the 409 branch reads the body and throws
`NoCredentialsError` instead of the generic message. The composer's
`onSend` catches it and opens the modal.

## Testing

**Backend (Vitest):**
- `ai-agent/tests/service/detect-agents.test.ts` (NEW):
  - Env override short-circuits and reports `source: 'env-override'`.
  - Detected path on a successful lookup.
  - Missing binary returns `available: false` (uses a deliberately bogus name).
- `conversation/tests/profiles/agent-home.test.ts` (extend):
  - `hasCredentials` returns false on empty home, true after touching the file.
  - `copyHomeFromSystem` no-ops if source missing, copies otherwise.
  - `copyProfileHome` round-trips a small fixture.
- `conversation/tests/profiles/profile-service.test.ts` (extend):
  - `copyProfile` creates the new profile and copies the home.
  - Rollback fires if the copy throws (verified by mocking `cpSync`).
- `conversation/tests/conversations/conversation-service.test.ts` (extend):
  - `sendMessage` throws `NoCredentialsError` when the profile home lacks
    credentials and the agent isn't `claude` with bootstrap fall-through.
- **Login PTY:** smoke-test backend route exists and rejects unknown profile
  with 1011. Full WS flow is manual-verify only — node-pty is platform-specific
  and the OAuth round-trip is impossible to mock cleanly.

**Frontend:**
- `tests/components/profile-picker.test.tsx` (extend):
  - With `availability.claude.available === false`, the row for the claude
    profile shows "not installed" and has reduced opacity.
- `tests/components/login-modal.test.tsx` (NEW):
  - Mounts with a mocked WebSocket; `logged-in` frame fires `onSuccess`;
    `exited` frame shows "code 1" with a Close button.
- `tests/lib/api-errors.test.ts` (NEW):
  - `api()` throws `NoCredentialsError` for a 409 with `code: 'no_credentials'`.

**Manual:**
- Bootstrap: nuke `agent-homes/claude-coding`, restart app, observe credentials
  appear inside.
- Copy: copy a logged-in profile, verify the new profile can send without
  re-logging in.
- Login modal: pick a profile with no home, click Send, complete the
  interactive flow in the modal, confirm send retries.

## YAGNI / explicitly deferred

- Detection re-runs on demand (e.g., after the user installs codex). Today
  it's boot-only; user can restart the app.
- Login button proactively in the picker (we auto-prompt on first send).
- "Logged in" green indicator on profile cards in the Profiles page (only
  affects discoverability).
- Re-mirror system Claude credentials when the user re-logs system-wide.
- Detection on the in-PATH version (e.g., "claude 0.6.0 is too old").
- Mac/Linux native-terminal fallback for users who can't run node-pty.
- Showing the OAuth URL inline if the CLI prints one — xterm.js renders it
  as a hyperlink via its built-in link detector; that's enough.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| `node-pty` build fails on first install (no Python / no compiler). | `node-pty` ships prebuilt binaries for Node 22 on common platforms; install error becomes a deal-breaker only for unusual setups. Document in CONTRIBUTING that the dev install requires the prebuilt to be available. |
| Electron packaging needs `electron-rebuild` for `node-pty`. | Note in the build steps in this spec; out-of-scope for the in-PR work but required before shipping a packaged build. |
| Credential filename changes upstream. | One constant (`CREDENTIAL_FILE`) governs the marker; reaffirmed by manual verification. |
| `fs.watch` on Windows isn't recursive by default but we watch only the top of the home; credential file lives there. | Confirmed via the existing `agent-home` layout (`{root}/{id}/{agent}/.credentials.json`). |
| Recursive copy fails partway through (disk full, permission). | `copyProfile` rolls back the inserted row. Bootstrap logs and continues without bootstrapping. |
| Two simultaneous login windows for the same profile race on the watcher. | Backend rejects a second WS upgrade if the profile already has an active session (Map<profileId, session>; return 409 close on duplicate). |
| The PTY child outlives the WS (e.g., user closes the modal mid-OAuth). | `onClose` kills the proc. Worst case: the kill signal arrives after credentials are written, in which case the watcher already fired success. |
| User picks a Codex profile while codex isn't installed. | Composer's Send is disabled with the inline strip. The login modal is *not* opened — the install issue must be resolved first. |

## Acceptance criteria

1. `getCatalog()` includes `agentAvailability.{claude,codex}.{available,path?,source}`.
2. ProfilePicker shows "not installed" inline + dims rows where the agent's
   `available === false`.
3. Composer's Send is disabled with a tooltip + inline install hint when the
   selected profile's agent isn't available.
4. Clicking Send on a profile whose home lacks credentials returns a 409
   from `/conversations/:id/messages` and opens `<LoginModal>` from the
   active-conversation page.
5. The login modal renders an interactive terminal (input + output) backed
   by a backend PTY via WebSocket.
6. Successful login triggers `onSuccess`; the composer retries the failed
   `sendMessage` and the conversation proceeds.
7. On a clean install where `~/.claude/.credentials.json` exists,
   `claude-coding` is usable without going through the login modal on first
   send.
8. Profiles → Copy on a logged-in source produces a new profile that
   `hasCredentials` reports as authenticated.
9. `pnpm typecheck` + `pnpm test` green (existing and new suites).
10. Manual `pnpm dev` walkthrough confirms acceptance criteria 4–8 end-to-end.

## File-by-file summary

| Path | Change |
|---|---|
| `packages/shared/src/index.ts` | NEW `AgentAvailability` interface. |
| `packages/ai-agent/src/service/detect-agents.ts` | NEW. |
| `packages/ai-agent/src/service/ai-agent-service.ts` | Call detect on boot, include in catalog. |
| `packages/conversation/src/profiles/agent-home.ts` | + `hasCredentials`, + `copyHomeFromSystem`, + `copyProfileHome`. |
| `packages/conversation/src/profiles/profile-service.ts` | + `copyProfile`, + `bootstrapDefaultClaudeProfile`. |
| `packages/conversation/src/conversations/conversation-service.ts` | sendMessage throws `NoCredentialsError`. |
| `packages/conversation/src/index.ts` | call bootstrap after seedBuiltins. |
| `packages/backend/src/conversation.ts` | 409 mapping for `no_credentials`. |
| `packages/backend/src/profile.ts` | + `POST /profiles/:id/copy`. |
| `packages/backend/src/login-pty.ts` | NEW WS PTY relay. |
| `packages/backend/src/server.ts` | Register WS upgrade + login-pty routes. |
| `packages/backend/package.json` | + `node-pty`, + `@hono/node-ws`. |
| `packages/frontend/src/api.ts` | + `copyProfile`, + `loginWsUrl`, + `NoCredentialsError`. |
| `packages/frontend/src/components/composer/profile-picker.tsx` | "not installed" badge + dim. |
| `packages/frontend/src/components/login-modal.tsx` | NEW xterm.js modal. |
| `packages/frontend/src/pages/active-conversation.tsx` | Auto-prompt + retry. |
| `packages/frontend/src/pages/profiles.tsx` | Copy uses new endpoint. |
| `packages/frontend/package.json` | + `xterm`, + `xterm-addon-fit`. |
| Tests (per file) | Listed in Testing section. |
