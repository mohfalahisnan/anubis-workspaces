# Conversations, Profiles, Skills — Design

**Date:** 2026-06-02
**Status:** Approved (pending writing-plans handoff)
**Scope:** Port AionCore's conversation / agent / session / skills model into the anubis-workspaces TypeScript monorepo. Replace AionCore's `Assistant` concept with a unified `Profile` concept.

---

## 1. Goals & Non-Goals

### Goals

1. Persistent conversations with messages, artifacts, and resumable agent sessions.
2. A `Profile` concept: a named, reusable bundle that prescribes agent, model, runtime knobs, skills, system prompt, and env. Replaces AionCore's `Assistant`.
3. Skill auto-injection (builtin auto-inject, builtin opt-in, user) with snapshot-at-create semantics matching AionCore.
4. Per-conversation hot agent processes with idle eviction (one running agent per conversation).
5. SSE streaming of agent events to clients; live persistence in parallel.
6. Cron command parsing (`[CRON_CREATE]…[/CRON_CREATE]`) → in-process scheduler that re-invokes conversations.

### Non-Goals (this pass)

- Multi-user / auth (single-user desktop).
- Confirmation / approval flow that pauses the runner (events forwarded only).
- WebSocket bidirectional channel (SSE one-way is enough).
- Message full-text search.
- Extension / team profile sources.
- Skill enable/disable mid-conversation (snapshot only; explicit `reset-skills` endpoint).
- Distributed scheduling (in-process node-cron only).

---

## 2. Architecture & Package Layout

```
packages/
├─ ai-agent/                       (unchanged scope: CLI runners + streaming)
│  └─ src/
│     ├─ agents/{claude,codex}/    existing
│     ├─ events/stream.ts          existing TypedEmitter
│     ├─ service/ai-agent-service.ts  field rename: profile → claudeCliProfile
│     └─ index.ts
│
├─ conversation/                   NEW — @anubis/conversation
│  └─ src/
│     ├─ db/
│     │  ├─ client.ts              better-sqlite3 singleton, WAL, foreign_keys=ON
│     │  ├─ migrations/            001_init.sql, ... applied at boot
│     │  └─ repositories/          conversations, messages, sessions, profiles, artifacts, cron-jobs
│     ├─ profiles/
│     │  ├─ types.ts               Profile, ProfileConfig, ResolvedProfile (+ Zod)
│     │  ├─ builtin.ts             shipped JSON definitions
│     │  ├─ profile-service.ts     merge builtin + user, CRUD, resolve
│     │  └─ resolve.ts             Profile → RunAgentInput overrides
│     ├─ skills/
│     │  ├─ types.ts               SkillDefinition, SkillIndex
│     │  ├─ loader.ts              discover builtin + user, parse SKILL.md frontmatter, cache
│     │  ├─ snapshot.ts            computeInitialSkills, backfill helpers
│     │  └─ inject.ts              build the system-prompt block from skill bodies
│     ├─ conversations/
│     │  ├─ types.ts               Conversation, Message, Artifact (+ Zod)
│     │  ├─ conversation-service.ts  create/list/get/update/delete, sendMessage orchestration
│     │  ├─ task-manager.ts        per-conversationId hot agent map + idle scanner
│     │  ├─ stream-relay.ts        subscribe to AgentStream, persist + SSE + cron parsing
│     │  └─ cron-detect.ts         [CRON_*] regex parser
│     ├─ cron/
│     │  └─ cron-service.ts        jobs table + node-cron dispatcher
│     ├─ sse/
│     │  └─ broadcaster.ts         per-conversation Set<ResponseWriter>, fan-out
│     └─ index.ts                  createConversationService(opts) composition root
│
└─ backend/
   └─ src/
      ├─ ai-agent.ts               existing; profile → claudeCliProfile in schema
      ├─ conversation.ts           NEW thin Hono routes
      ├─ profile.ts                NEW thin Hono routes
      ├─ skill.ts                  NEW thin Hono routes
      ├─ cron.ts                   NEW thin Hono routes
      └─ app.ts                    mount new route groups

packages/ai-agent/skills/
├─ auto-inject/<name>/SKILL.md     shipped builtins, always-on unless excluded
└─ opt-in/<name>/SKILL.md          shipped builtins, only when enabled

{userData}/anubis/
├─ anubis.db                       SQLite file
└─ skills/<name>/SKILL.md          user-installed skills
```

`apps/desktop/electron/main/backend.ts` already passes a child-process env. Extend it with `ANUBIS_DATA_DIR` so the backend resolves the DB path and user skill root.

`createConversationService({ dataDir, aiAgent, skillRoots })` is the single composition root the backend constructs once.

---

## 3. Data Model (SQLite)

All `*_at` columns are `INTEGER` epoch milliseconds. `extra` / `config` / `metadata` columns are JSON text validated at the repository layer with Zod, not by SQLite. Migrations applied at boot via a `schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER)` table.

```sql
-- conversations
CREATE TABLE conversations (
  id              TEXT PRIMARY KEY,             -- UUID v7
  title           TEXT NOT NULL,
  agent           TEXT NOT NULL,                -- 'claude' | 'codex'
  status          TEXT NOT NULL,                -- 'pending' | 'running' | 'finished' | 'error'
  profile_id      TEXT,                         -- FK profiles.id (nullable: ad-hoc convo)
  workspace_path  TEXT NOT NULL,                -- cwd the agent runs in
  extra           TEXT NOT NULL DEFAULT '{}',   -- JSON: skills snapshot, per-convo overrides
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  deleted_at      INTEGER
);
CREATE INDEX idx_conversations_updated_at
  ON conversations(updated_at DESC) WHERE deleted_at IS NULL;

-- messages
CREATE TABLE messages (
  id              TEXT PRIMARY KEY,             -- UUID v7
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  msg_id          TEXT NOT NULL,                -- client-facing correlation id (per turn)
  role            TEXT NOT NULL,                -- 'user' | 'assistant' | 'system'
  content         TEXT NOT NULL,
  metadata        TEXT,                         -- JSON: thinking, tool_calls summary, usage, error
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_messages_convo ON messages(conversation_id, created_at);

-- artifacts (per tool call)
CREATE TABLE artifacts (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id      TEXT REFERENCES messages(id) ON DELETE SET NULL,
  kind            TEXT NOT NULL,                -- 'tool_call'
  tool_name       TEXT NOT NULL,
  call_id         TEXT NOT NULL,                -- agent's tool call id
  input           TEXT,                         -- JSON
  output          TEXT,                         -- JSON or string
  status          TEXT NOT NULL,                -- 'running' | 'success' | 'error'
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_artifacts_convo ON artifacts(conversation_id, created_at);

-- sessions (one row per (conversation, agent) resume handle)
CREATE TABLE agent_sessions (
  conversation_id  TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  agent            TEXT NOT NULL,               -- 'claude' | 'codex'
  agent_session_id TEXT NOT NULL,               -- claude --resume id  OR  codex thread id
  model            TEXT,                        -- last model used (for UI)
  updated_at       INTEGER NOT NULL
);

-- profiles
CREATE TABLE profiles (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  source          TEXT NOT NULL,                -- 'builtin' | 'user'
  agent           TEXT NOT NULL,                -- 'claude' | 'codex'
  config          TEXT NOT NULL,                -- JSON: full ProfileConfig
  sort_order      INTEGER NOT NULL DEFAULT 0,
  last_used_at    INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE UNIQUE INDEX uq_profiles_source_id ON profiles(source, id);

-- profile_overrides (user tweaks to a builtin profile, doesn't fork it)
CREATE TABLE profile_overrides (
  profile_id      TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  config_patch    TEXT NOT NULL,                -- JSON deep-merged onto profiles.config
  sort_order      INTEGER,
  updated_at      INTEGER NOT NULL
);

-- cron jobs (created via [CRON_CREATE] blocks)
CREATE TABLE cron_jobs (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  schedule        TEXT NOT NULL,                -- cron expression
  schedule_desc   TEXT,
  prompt          TEXT NOT NULL,                -- message to re-send on tick
  enabled         INTEGER NOT NULL DEFAULT 1,
  last_run_at     INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
```

**Write batching.** Per-turn token accumulation flushes a single transaction every ~20 chunks (or every 250 ms, whichever first) to avoid per-token fsync cost.

**Notes.**

- `conversations.extra` shape: `{ skills: string[], overrides?: Partial<ProfileConfig> }`. The `skills` array is the **snapshot computed at create time** and is never recomputed automatically.
- No `users` table — single-user desktop scope. When team mode lands later, add a nullable `user_id` to relevant tables; everything else is unchanged.

---

## 4. Profile Model

```ts
// packages/conversation/src/profiles/types.ts
import type { Agent, ReasoningEffort } from '@anubis/ai-agent'

export type ProfileSource = 'builtin' | 'user'
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
export type ApprovalPolicy = 'untrusted' | 'on-request' | 'on-failure' | 'never'
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'

export interface ProfileConfig {
  agent: Agent
  model?: string
  reasoningEffort?: ReasoningEffort
  // runtime knobs (forwarded to AiAgentService)
  sandboxMode?: SandboxMode         // codex
  approvalPolicy?: ApprovalPolicy   // codex
  permissionMode?: PermissionMode   // claude
  allowedTools?: string[]           // claude
  disallowedTools?: string[]        // claude
  appendSystemPrompt?: string
  env?: Record<string, string>      // forwarded as extraEnv
  claudeCliProfile?: string         // claude --profile flag (passthrough)
  // skills
  enabledSkills?: string[]          // opt-in builtins + user by name
  disabledBuiltinSkills?: string[]  // turn off specific auto-inject builtins
}

export interface Profile {
  id: string
  name: string
  description?: string
  source: ProfileSource
  config: ProfileConfig
  sortOrder: number
  lastUsedAt?: number
  createdAt: number
  updatedAt: number
}

export type ProfileOverride = Partial<ProfileConfig>
export type ResolvedProfile = Required<Pick<ProfileConfig, 'agent'>> & ProfileConfig
```

### Resolution chain (highest wins)

```
runtime override (per POST /messages)
  → conversation.extra.overrides       (sticky overrides for this convo)
    → profile_overrides.config_patch   (user tweaks to a builtin)
      → profiles.config                (base)
        → built-in defaults            (DEFAULT_MODEL[agent], DEFAULT_REASONING_EFFORT)
```

Implemented as `resolveProfile({ profileId, override }, db) → ResolvedProfile`. The conversation service then translates `ResolvedProfile → RunAgentInput` for `AiAgentService.streamAgent()`.

### Builtin seed (idempotent UPSERT at boot, `source='builtin'`)

- `claude-coding` — claude / sonnet / `permissionMode: 'plan'` / auto-inject skills only
- `claude-yolo` — claude / sonnet / `permissionMode: 'bypassPermissions'`
- `claude-research` — claude / opus / `permissionMode: 'plan'` / research system prompt
- `codex-coding` — codex / gpt-5.4 / `sandboxMode: 'workspace-write'` / `approvalPolicy: 'on-request'`
- `codex-yolo` — codex / gpt-5.4 / `sandboxMode: 'danger-full-access'` / `approvalPolicy: 'never'`

### ProfileService surface

```ts
class ProfileService {
  list(): Profile[]                              // builtin ∪ user, merged with overrides
  get(id: string): Profile | null
  create(input: CreateProfileInput): Profile     // source='user' only
  update(id: string, patch: UpdateProfileInput): Profile
  delete(id: string): void                       // source='user' only; for 'builtin', deletes its override
  setOverride(id: string, patch: ProfileOverride): void
  resolve(id: string | null, override?: ProfileOverride): ResolvedProfile
  touchLastUsed(id: string): void                // bumped after a turn finishes
}
```

Validation: Zod schemas at every CRUD boundary and again at HTTP. `agent` and `model` cross-check against `@anubis/ai-agent`'s `MODELS` / `isAgent` / `isKnownModel`.

`Conversation.profileId` is nullable — a conversation may run without a profile if the request carries enough fields itself. Legacy `POST /ai-agent/run` callers continue to work unchanged.

**Immutable fields after create.** `conversations.agent` is pinned at create time. Subsequent `PATCH` or per-turn `override` MUST NOT change `agent` — the service rejects (400) any attempt. Switching agents requires creating a new conversation. `profileId` may change only to a profile whose `agent` matches.

---

## 5. Skills Pipeline

### On-disk layout

```
packages/ai-agent/skills/
├─ auto-inject/<name>/SKILL.md      always-on for new convos unless disabled
└─ opt-in/<name>/SKILL.md           only when listed in enabledSkills

{userData}/anubis/skills/
└─ <name>/SKILL.md                  user-installed; always opt-in
```

### SKILL.md format

```markdown
---
name: cron-helper
description: Help the user create and manage scheduled tasks.
when_to_use: User mentions schedules, cron, recurring jobs.
---

# Cron Helper
…body…
```

Parsed once on load. Cached in memory; invalidated by an explicit `reloadSkills()` call (also exposed via `POST /skills/reload`).

### Types

```ts
export type SkillSource = 'builtin-auto' | 'builtin-opt-in' | 'user'

export interface SkillDefinition {
  name: string
  description: string
  whenToUse?: string
  source: SkillSource
  path: string             // absolute SKILL.md path
  body: string             // markdown body (frontmatter stripped)
}

export interface SkillIndex {
  name: string
  description: string
  whenToUse?: string
  source: SkillSource
}
```

### Loader

`SkillLoader.discoverAll(): SkillDefinition[]` walks both roots, dedupes by `name` with precedence `user > builtin-opt-in > builtin-auto`. Throws on duplicate names **within the same source**. Frontmatter parsed with `gray-matter`.

### Snapshot at conversation creation

```ts
export function computeInitialSkills(
  allSkills: SkillDefinition[],
  profile: ResolvedProfile,
): string[] {
  const autoInject = allSkills
    .filter(s => s.source === 'builtin-auto')
    .map(s => s.name)
    .filter(n => !profile.disabledBuiltinSkills?.includes(n))

  const optIn = (profile.enabledSkills ?? [])
    .filter(n => allSkills.some(s => s.name === n))

  return [...new Set([...autoInject, ...optIn])].sort()
}
```

Stored once in `conversations.extra.skills`. **Never recomputed automatically.** Changing the disk catalog or the profile later does not retroactively rewrite existing conversations. Refresh on demand via `POST /conversations/:id/reset-skills`.

### Injection into agent

Per turn, the conversation service builds `appendSystemPrompt` from:

1. `profile.appendSystemPrompt` (raw)
2. A skills block built from `conversations.extra.skills`:

```ts
function buildSkillsBlock(skills: SkillDefinition[]): string {
  if (skills.length === 0) return ''
  return [
    '## Available Skills',
    'You have access to the following skills. Apply them when relevant.',
    '',
    ...skills.map(s => `### ${s.name}\n${s.body.trim()}`),
  ].join('\n\n')
}
```

`appendSystemPrompt = [profile.appendSystemPrompt, skillsBlock].filter(Boolean).join('\n\n')`

This flows into `AiAgentService.streamAgent({ appendSystemPrompt, … })`. The existing `wrap-system-prompt.ts` in `@anubis/ai-agent` handles per-agent plumbing.

---

## 6. Task Manager, Sessions, Stream Relay, Cron

### TaskManager

One hot agent process per conversation. Idle scanner sweeps every 60 s; kills tasks past `idleMs` (default 10 min, matches existing `CodexPool`).

```ts
class TaskManager {
  constructor(private aiAgent: AiAgentService, private idleMs = 10 * 60_000)

  async getOrBuild(conv: Conversation, profile: ResolvedProfile): Promise<AgentTask>
  subscribe(conversationId: string): TypedEmitter<AgentEventMap> | null
  async kill(conversationId: string, reason: 'idle' | 'user' | 'shutdown'): Promise<void>
}

interface AgentTask {
  conversationId: string
  agent: Agent
  status: 'pending' | 'running' | 'finished' | 'error'
  agentSessionId?: string
  lastActivityAt: number
  emitter: TypedEmitter<AgentEventMap>
  sendMessage(input: { prompt: string; msgId: string }): Promise<void>
  cancel(): Promise<void>
}
```

Concurrency: `getOrBuild` keeps an in-flight `Promise<AgentTask>` per conversationId so two concurrent `POST /messages` don't double-spawn (AionCore `OnceCell` pattern). Same conversation → sequential turns, awaiting the prior message.

### Per-turn flow

```
POST /conversations/:id/messages
  ↓
ConversationService.sendMessage(convId, { content, override? })
  ├─ load conv + profile, resolve → ResolvedProfile + skills block
  ├─ msgId = uuidv7()
  ├─ insert messages row { role: 'user', content }                          [txn]
  ├─ task = taskManager.getOrBuild(conv, resolved)
  ├─ relay = new StreamRelay(convId, msgId, deps); relay.attach(task.emitter)
  ├─ await task.sendMessage({ prompt: content, msgId })
  └─ return { msgId }                                                       (relay continues in bg)
```

Resume mapping: when an `agent_sessions` row exists for the conversation, `getOrBuild` passes that `agent_session_id` as `prevAgentSessionId` into `AiAgentService.streamAgent()`. On the agent's `session` event, the row is upserted.

### StreamRelay

| Event | Action |
|---|---|
| `partial` | append to in-memory text buffer; every ~20 chunks (or 250 ms) UPSERT the assistant message row in a single txn; fan-out chunk to SSE |
| `thinking` | persist into `messages.metadata.thinking[]`; forward to SSE |
| `tool_call` | INSERT artifact row (status='running'); forward to SSE |
| `tool_result` | UPDATE artifact row (status, output); forward to SSE |
| `session` | UPSERT `agent_sessions(conversationId, agentSessionId)` |
| `done` | flush buffer → final message write (incl. usage in metadata); `cronDetect(text)` → CronService; mark conversation status=`finished`; emit `done` to SSE; release relay |
| `error` | mark conversation status=`error`, persist `messages.metadata.error`, emit to SSE |

### Cron parsing

`cron-detect.ts` runs only at `done` (parsing on every `partial` would refire). Matches:

```
[CRON_CREATE]\nname: …\nschedule: …\nschedule_description: …\nmessage: …\n[/CRON_CREATE]
[CRON_UPDATE: <id>]…[/CRON_UPDATE]
[CRON_DELETE: <id>]
[CRON_LIST]
```

Each parsed command goes through `CronService.handle(cmd, conversationId)`. Result strings are pushed back to the user as a `system`-role message (visible in transcripts as a `## Scheduled jobs` block).

### CronService

Single in-process `node-cron` scheduler. Rehydrates enabled jobs on boot from `cron_jobs`. On tick, calls back into `ConversationService.sendMessage(conversationId, { content: prompt })` — re-enters the regular turn pipeline.

**Trade-off:** restarts miss jobs that would have fired while the app was closed. Acceptable for a desktop tool; surfacing missed-fire stats in `GET /cron-jobs` is a small future addition.

### SSE broadcaster

`GET /conversations/:id/stream` — Server-Sent Events. On connect, server writes the buffered in-flight assistant message so reconnects don't miss content. Connection stays open across turns. One `Map<conversationId, Set<WriteStream>>` in the broadcaster — single-process desktop app, no pub/sub bus.

### Idle + shutdown

- Idle scanner sweeps every 60 s; kills tasks past `idleMs`.
- Electron `before-quit` triggers `taskManager.shutdown()` → `kill(id, 'shutdown')` for all, awaits child exits with a 5 s grace.

### Cancellation

`task.cancel()` → SIGTERM to the child. Half-written assistant message rows are kept (truncated) and the `done`/`error` handler flips status to `error`.

---

## 7. HTTP API

All write routes validated with Zod at the route layer; errors normalized in `app.ts` (`ZodError` → 400 with `issues`). Existing top-level response envelope `{ ok: true, ... }` is preserved.

```
# Conversations
POST   /conversations                    create({ title?, profileId?, override?, workspacePath?, agent? })
                                         → ConversationResponse  (agent inferred from profile if profileId set)
GET    /conversations                    list({ limit?, cursor?, archived? })
                                         → { items: ConversationSummary[], nextCursor? }
GET    /conversations/:id                → ConversationResponse (profile, skills snapshot, agent_session_id)
PATCH  /conversations/:id                update({ title?, override?, archived? })
DELETE /conversations/:id                soft-delete (cascade messages, artifacts, agent_sessions, cron_jobs)
POST   /conversations/:id/reset-skills   recompute snapshot → { skills: string[] }

# Messages / streaming
POST   /conversations/:id/messages       send({ content, override?, files? }) → { msgId }
GET    /conversations/:id/messages       list({ limit?, before? }) → MessageResponse[]
GET    /conversations/:id/messages/:mid  → MessageResponse (with artifacts joined)
GET    /conversations/:id/stream         SSE: 'partial' | 'thinking' | 'tool_call' | 'tool_result'
                                              | 'session' | 'done' | 'error'
POST   /conversations/:id/cancel         SIGTERM the active task → { ok: true }

# Artifacts
GET    /conversations/:id/artifacts                → ArtifactResponse[]
GET    /conversations/:id/artifacts/:aid           → ArtifactResponse

# Profiles
GET    /profiles                         → Profile[] (builtin ∪ user, sorted by sortOrder asc, lastUsedAt desc)
GET    /profiles/:id                     → Profile
POST   /profiles                         create({ name, description?, agent, config }) → Profile (source='user')
PATCH  /profiles/:id                     update — user: deep-merges into config
                                                — builtin: writes profile_overrides row
DELETE /profiles/:id                     user: hard-delete | builtin: removes its override (resets to defaults)
POST   /profiles/:id/resolve             dry-run → ResolvedProfile

# Skills
GET    /skills                           → SkillIndex[]  (all sources)
GET    /skills/:name                     → SkillDefinition (with body)
POST   /skills/reload                    re-walk disk → { count: number }

# Cron
GET    /cron-jobs                        → CronJob[]  (optional filter by conversationId)
PATCH  /cron-jobs/:id                    update({ enabled?, schedule?, prompt?, name? })
DELETE /cron-jobs/:id                    remove + unschedule

# AI agent (existing)
GET    /ai-agent/catalog                 unchanged
POST   /ai-agent/run                     existing, BUT: profile → claudeCliProfile (rename in schema)
                                         New optional: profileId — when set, resolves via ProfileService first
```

Mount points in `apps/desktop` backend (`app.ts`):

```ts
app.route('/ai-agent', aiAgentRoutes)            // kept
app.route('/conversations', conversationRoutes)  // NEW
app.route('/profiles', profileRoutes)            // NEW
app.route('/skills', skillRoutes)                // NEW
app.route('/cron-jobs', cronJobRoutes)           // NEW
```

### Notable contracts

- `ConversationResponse` includes `profileId`, `resolvedProfile` (snapshot at last turn, for UI), `skills: string[]` (snapshot), `agentSessionId`.
- `MessageResponse.metadata` shape: `{ thinking?: string[], usage?: ExtractedUsage, toolCallIds?: string[], error?: { code, message } }`.
- SSE events match the existing `AgentEventMap` from `@anubis/ai-agent` 1:1 — same names, same payloads.

### Breaking changes

- `RunAgentInput.profile` (Claude `--profile` passthrough) is renamed to `claudeCliProfile`. Affects:
  - `packages/ai-agent/src/service/ai-agent-service.ts` (field + plumbing)
  - `packages/backend/src/ai-agent.ts` (Zod schema)
  - Any frontend caller (`packages/frontend/src/api.ts` and consumers) — must be swept.
  - Tests under `packages/ai-agent/tests/` if any reference the field.

---

## 8. Dependencies (new)

- `better-sqlite3` — embedded SQLite, sync API, fast.
- `gray-matter` — YAML frontmatter parser for SKILL.md.
- `node-cron` — in-process cron scheduler.
- `uuid` (v7) — `uuidv7()` for IDs (or a small inline implementation).

All small, well-maintained, MIT-licensed.

---

## 9. Open Questions Resolved (record of decisions)

| # | Decision | Choice |
|---|---|---|
| 1 | Scope | Full port (conversations + messages + sessions + skills + profiles + stream relay) |
| 2 | Persistence | SQLite via `better-sqlite3` |
| 3 | Profile shape | Full bundle (agent, model, reasoning, sandbox, approval, permission, tools, env, append-system, skills, claudeCliProfile) |
| 4 | Naming clash | Rename existing Claude flag `profile` → `claudeCliProfile`; new concept = `profileId` |
| 5 | Profile sources | Builtin + User (no extensions/team this pass) |
| 6 | Skill location | `packages/ai-agent/skills/{auto-inject,opt-in}` + `{userData}/anubis/skills/` |
| 7 | Streaming | SSE per-conversation |
| 8 | Agent reuse | Per-conversation hot agent w/ idle scanner |
| 9 | Extras | Artifacts + cron parsing (no confirmation flow, no FTS) |
| 10 | Package layout | One new `@anubis/conversation` package |
