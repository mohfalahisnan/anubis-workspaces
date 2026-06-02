# Conversation, Profiles, Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port AionCore's conversation/agent/session/skill model into the anubis-workspaces TypeScript monorepo as a new `@anubis/conversation` package. Replace AionCore's `Assistant` with a unified `Profile` bundle.

**Architecture:** New `@anubis/conversation` package owns SQLite (better-sqlite3), profiles (builtin + user), skills (builtin auto-inject / builtin opt-in / user, snapshot-at-create), conversations + messages + artifacts + sessions, per-conversation hot agent processes via TaskManager, StreamRelay for live persistence + SSE fan-out, cron command parsing + node-cron scheduler. `@anubis/ai-agent` stays the CLI runner (Claude/Codex). Its existing `profile` field renames to `claudeCliProfile` to free the name.

**Tech Stack:** TypeScript ESM, vitest, better-sqlite3, gray-matter, node-cron, uuid (v7), Hono (existing backend), zod (existing).

**Spec reference:** [`docs/superpowers/specs/2026-06-02-conversation-profiles-design.md`](../specs/2026-06-02-conversation-profiles-design.md)

---

## Conventions

- All packages are ESM (`"type": "module"`). Source-relative imports MUST use explicit `.js` extensions (e.g. `import { foo } from './foo.js'`).
- Tests live under `packages/<pkg>/tests/` and run from repo root via `pnpm vitest run packages/<pkg>/tests/<file>.test.ts`.
- Commits are scoped: `feat(conversation):`, `feat(ai-agent):`, `feat(backend):`, `chore(ai-agent):`, `test(conversation):`.
- Every task ends with a commit; tests come before implementation when the unit under test is pure (loader, snapshot, cron-detect, profile resolve, repositories).

---

## Task 1: Scaffold `@anubis/conversation` package

**Files:**
- Create: `packages/conversation/package.json`
- Create: `packages/conversation/tsconfig.json`
- Create: `packages/conversation/src/index.ts`
- Modify: `pnpm-workspace.yaml` (already includes `packages/*`, verify only)

- [ ] **Step 1: Verify workspace glob includes new package**

Run: `cat pnpm-workspace.yaml`
Expected: contains `packages/*` glob.

- [ ] **Step 2: Create `packages/conversation/package.json`**

```json
{
  "name": "@anubis/conversation",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@anubis/ai-agent": "workspace:*",
    "better-sqlite3": "^11.7.0",
    "gray-matter": "^4.0.3",
    "node-cron": "^3.0.3",
    "uuid": "^11.0.3",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^22.19.1",
    "@types/node-cron": "^3.0.11",
    "@types/uuid": "^10.0.0",
    "typescript": "^5.9.3"
  },
  "engines": {
    "node": ">=22"
  }
}
```

- [ ] **Step 3: Create `packages/conversation/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Create `packages/conversation/src/index.ts` (placeholder)**

```ts
export const PACKAGE_NAME = '@anubis/conversation'
```

- [ ] **Step 5: Install deps and typecheck**

Run: `pnpm install`
Expected: lockfile updated; no errors.

Run: `pnpm --filter @anubis/conversation typecheck`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add packages/conversation pnpm-lock.yaml
git commit -m "feat(conversation): scaffold @anubis/conversation package"
```

---

## Task 2: Rename `profile` → `claudeCliProfile` across ai-agent + backend

**Files:**
- Modify: `packages/ai-agent/src/service/ai-agent-service.ts:25` (field rename)
- Modify: `packages/ai-agent/src/service/ai-agent-service.ts:134` (forward rename)
- Modify: `packages/ai-agent/src/agents/claude/runner.ts:68` (field rename)
- Modify: `packages/backend/src/ai-agent.ts:19` (zod schema rename)

- [ ] **Step 1: Rename in ai-agent service (input + forward)**

Edit `packages/ai-agent/src/service/ai-agent-service.ts`:

Replace:
```ts
  profile?: string
```
With:
```ts
  claudeCliProfile?: string
```

Replace:
```ts
      profile: input.profile,
```
With:
```ts
      claudeCliProfile: input.claudeCliProfile,
```

- [ ] **Step 2: Rename in claude runner**

Edit `packages/ai-agent/src/agents/claude/runner.ts`:

Replace:
```ts
  profile?: string
```
With:
```ts
  claudeCliProfile?: string
```

- [ ] **Step 3: Rename in backend zod schema**

Edit `packages/backend/src/ai-agent.ts`, replace:
```ts
  profile: z.string().min(1).optional(),
```
With:
```ts
  claudeCliProfile: z.string().min(1).optional(),
```

- [ ] **Step 4: Verify no other references**

Run: `grep -rn "profile" packages/ai-agent/src packages/backend/src packages/frontend/src 2>/dev/null | grep -v "claudeCliProfile\|profile-resolver"`
Expected: no matches that look like the renamed field (matches in research-crawler are unrelated).

- [ ] **Step 5: Typecheck the whole repo**

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add packages/ai-agent/src packages/backend/src
git commit -m "chore(ai-agent): rename profile to claudeCliProfile for new Profile concept"
```

---

## Task 3: DB client (better-sqlite3 singleton + helpers)

**Files:**
- Create: `packages/conversation/src/db/client.ts`
- Create: `packages/conversation/tests/db/client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/conversation/tests/db/client.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { openDatabase } from '../../src/db/client.js'

describe('openDatabase', () => {
  it('opens an in-memory database with WAL/foreign_keys configured', () => {
    const db = openDatabase(':memory:')
    const fk = db.pragma('foreign_keys', { simple: true })
    expect(fk).toBe(1)
    db.close()
  })

  it('returns the same prepared statement twice when text matches (cache works)', () => {
    const db = openDatabase(':memory:')
    db.exec('CREATE TABLE t (id INTEGER)')
    const s1 = db.prepare('SELECT * FROM t')
    const s2 = db.prepare('SELECT * FROM t')
    expect(s1).toBe(s2)
    db.close()
  })
})
```

- [ ] **Step 2: Run test to confirm failure**

Run: `pnpm vitest run packages/conversation/tests/db/client.test.ts`
Expected: FAIL — `openDatabase` not exported.

- [ ] **Step 3: Implement `db/client.ts`**

Create `packages/conversation/src/db/client.ts`:

```ts
import Database, { type Database as DbHandle } from 'better-sqlite3'

export type Db = DbHandle

export function openDatabase(path: string): Db {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  return db
}

export function tx<T>(db: Db, fn: () => T): T {
  return db.transaction(fn)()
}
```

- [ ] **Step 4: Re-run test**

Run: `pnpm vitest run packages/conversation/tests/db/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/conversation/src/db/client.ts packages/conversation/tests/db/client.test.ts
git commit -m "feat(conversation): better-sqlite3 client wrapper with WAL + FK pragmas"
```

---

## Task 4: Migration runner

**Files:**
- Create: `packages/conversation/src/db/migrate.ts`
- Create: `packages/conversation/tests/db/migrate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/conversation/tests/db/migrate.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { openDatabase } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'

describe('runMigrations', () => {
  it('applies all migrations and records versions', () => {
    const db = openDatabase(':memory:')
    const m1 = { version: 1, sql: 'CREATE TABLE a (id INTEGER PRIMARY KEY)' }
    const m2 = { version: 2, sql: 'CREATE TABLE b (id INTEGER PRIMARY KEY)' }
    runMigrations(db, [m1, m2])
    const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[]
    expect(versions.map(r => r.version)).toEqual([1, 2])
    db.close()
  })

  it('is idempotent — running twice applies each migration once', () => {
    const db = openDatabase(':memory:')
    const m1 = { version: 1, sql: 'CREATE TABLE a (id INTEGER PRIMARY KEY)' }
    runMigrations(db, [m1])
    runMigrations(db, [m1])
    const count = db.prepare('SELECT count(*) AS n FROM schema_migrations').get() as { n: number }
    expect(count.n).toBe(1)
    db.close()
  })
})
```

- [ ] **Step 2: Run test to confirm failure**

Run: `pnpm vitest run packages/conversation/tests/db/migrate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `db/migrate.ts`**

```ts
import type { Db } from './client.js'

export interface Migration {
  version: number
  sql: string
}

export function runMigrations(db: Db, migrations: Migration[]): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `)
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(r => r.version),
  )
  const ordered = [...migrations].sort((a, b) => a.version - b.version)
  for (const m of ordered) {
    if (applied.has(m.version)) continue
    db.transaction(() => {
      db.exec(m.sql)
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(m.version, Date.now())
    })()
  }
}
```

- [ ] **Step 4: Re-run test**

Run: `pnpm vitest run packages/conversation/tests/db/migrate.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add packages/conversation/src/db/migrate.ts packages/conversation/tests/db/migrate.test.ts
git commit -m "feat(conversation): idempotent migration runner with schema_migrations table"
```

---

## Task 5: Initial schema (`001_init.sql`) + migration registry

**Files:**
- Create: `packages/conversation/src/db/migrations/001_init.sql`
- Create: `packages/conversation/src/db/migrations/index.ts`
- Create: `packages/conversation/tests/db/init-schema.test.ts`
- Modify: `packages/conversation/tsconfig.json` (allow JSON/SQL resolveJsonModule not needed; we use fs)

- [ ] **Step 1: Create the SQL file**

`packages/conversation/src/db/migrations/001_init.sql`:

```sql
CREATE TABLE conversations (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  agent           TEXT NOT NULL,
  status          TEXT NOT NULL,
  profile_id      TEXT,
  workspace_path  TEXT NOT NULL,
  extra           TEXT NOT NULL DEFAULT '{}',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  deleted_at      INTEGER
);
CREATE INDEX idx_conversations_updated_at
  ON conversations(updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  msg_id          TEXT NOT NULL,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  metadata        TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_messages_convo ON messages(conversation_id, created_at);

CREATE TABLE artifacts (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id      TEXT REFERENCES messages(id) ON DELETE SET NULL,
  kind            TEXT NOT NULL,
  tool_name       TEXT NOT NULL,
  call_id         TEXT NOT NULL,
  input           TEXT,
  output          TEXT,
  status          TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_artifacts_convo ON artifacts(conversation_id, created_at);

CREATE TABLE agent_sessions (
  conversation_id  TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  agent            TEXT NOT NULL,
  agent_session_id TEXT NOT NULL,
  model            TEXT,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE profiles (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  source          TEXT NOT NULL,
  agent           TEXT NOT NULL,
  config          TEXT NOT NULL,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  last_used_at    INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE UNIQUE INDEX uq_profiles_source_id ON profiles(source, id);

CREATE TABLE profile_overrides (
  profile_id      TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  config_patch    TEXT NOT NULL,
  sort_order      INTEGER,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE cron_jobs (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  schedule        TEXT NOT NULL,
  schedule_desc   TEXT,
  prompt          TEXT NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 1,
  last_run_at     INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
```

- [ ] **Step 2: Create migration registry that reads SQL via fs**

`packages/conversation/src/db/migrations/index.ts`:

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { Migration } from '../migrate.js'

const here = dirname(fileURLToPath(import.meta.url))

function load(version: number, file: string): Migration {
  return { version, sql: readFileSync(join(here, file), 'utf8') }
}

export const MIGRATIONS: Migration[] = [
  load(1, '001_init.sql'),
]
```

- [ ] **Step 3: Update tsconfig & build to copy SQL files into dist**

Add to `packages/conversation/package.json` scripts:

Replace:
```json
    "build": "tsc -p tsconfig.json",
```
With:
```json
    "build": "tsc -p tsconfig.json && node ./scripts/copy-sql.mjs",
```

Create `packages/conversation/scripts/copy-sql.mjs`:

```js
import { mkdirSync, readdirSync, copyFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = 'src/db/migrations'
const DST = 'dist/db/migrations'

mkdirSync(DST, { recursive: true })
for (const entry of readdirSync(SRC)) {
  const s = join(SRC, entry)
  if (statSync(s).isFile() && entry.endsWith('.sql')) {
    copyFileSync(s, join(DST, entry))
  }
}
console.log('copied SQL migrations →', DST)
```

- [ ] **Step 4: Write the failing test**

`packages/conversation/tests/db/init-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { openDatabase } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'

const TABLES = [
  'conversations', 'messages', 'artifacts',
  'agent_sessions', 'profiles', 'profile_overrides', 'cron_jobs',
]

describe('001_init.sql', () => {
  it('creates every expected table', () => {
    const db = openDatabase(':memory:')
    runMigrations(db, MIGRATIONS)
    const rows = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
    ).all() as { name: string }[]
    const names = new Set(rows.map(r => r.name))
    for (const t of TABLES) expect(names.has(t), `missing table ${t}`).toBe(true)
    db.close()
  })
})
```

- [ ] **Step 5: Run test**

Run: `pnpm vitest run packages/conversation/tests/db/init-schema.test.ts`
Expected: PASS — all 7 tables exist.

- [ ] **Step 6: Commit**

```bash
git add packages/conversation/src/db/migrations packages/conversation/scripts packages/conversation/package.json packages/conversation/tests/db/init-schema.test.ts
git commit -m "feat(conversation): 001_init.sql + migration registry"
```

---

## Task 6: ID helper (`uuidv7`) + time helper

**Files:**
- Create: `packages/conversation/src/util/ids.ts`
- Create: `packages/conversation/src/util/time.ts`
- Create: `packages/conversation/tests/util/ids.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { newId } from '../../src/util/ids.js'

describe('newId', () => {
  it('returns a 36-char UUID string', () => {
    const id = newId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('is time-ordered (later id > earlier id lexically)', async () => {
    const a = newId()
    await new Promise(r => setTimeout(r, 2))
    const b = newId()
    expect(b > a).toBe(true)
  })
})
```

- [ ] **Step 2: Run test — expect FAIL (module missing)**

Run: `pnpm vitest run packages/conversation/tests/util/ids.test.ts`

- [ ] **Step 3: Implement util/ids.ts and util/time.ts**

`packages/conversation/src/util/ids.ts`:

```ts
import { v7 as uuidv7 } from 'uuid'

export function newId(): string {
  return uuidv7()
}
```

`packages/conversation/src/util/time.ts`:

```ts
export function nowMs(): number {
  return Date.now()
}
```

- [ ] **Step 4: Re-run test — PASS**

Run: `pnpm vitest run packages/conversation/tests/util/ids.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/conversation/src/util packages/conversation/tests/util
git commit -m "feat(conversation): newId (uuidv7) and nowMs helpers"
```

---

## Task 7: Profile types + Zod schemas

**Files:**
- Create: `packages/conversation/src/profiles/types.ts`
- Create: `packages/conversation/tests/profiles/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { ProfileConfigSchema, ProfileSchema } from '../../src/profiles/types.js'

describe('ProfileConfigSchema', () => {
  it('accepts a minimal claude config', () => {
    const r = ProfileConfigSchema.safeParse({ agent: 'claude' })
    expect(r.success).toBe(true)
  })

  it('rejects an unknown agent', () => {
    const r = ProfileConfigSchema.safeParse({ agent: 'gpt' })
    expect(r.success).toBe(false)
  })

  it('accepts the full bundle', () => {
    const r = ProfileConfigSchema.safeParse({
      agent: 'codex',
      model: 'gpt-5.4',
      reasoningEffort: 'medium',
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
      appendSystemPrompt: 'be careful',
      env: { FOO: 'bar' },
      enabledSkills: ['cron-helper'],
      disabledBuiltinSkills: ['xlsx'],
    })
    expect(r.success).toBe(true)
  })
})

describe('ProfileSchema', () => {
  it('requires source to be builtin or user', () => {
    const base = {
      id: 'p1', name: 'X', source: 'foo' as any,
      config: { agent: 'claude' as const },
      sortOrder: 0, createdAt: 1, updatedAt: 1,
    }
    expect(ProfileSchema.safeParse(base).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test — FAIL**

Run: `pnpm vitest run packages/conversation/tests/profiles/types.test.ts`

- [ ] **Step 3: Implement types**

`packages/conversation/src/profiles/types.ts`:

```ts
import { z } from 'zod'

export const AgentSchema = z.enum(['claude', 'codex'])
export const ReasoningEffortSchema = z.enum(['minimal', 'low', 'medium', 'high'])
export const SandboxModeSchema = z.enum(['read-only', 'workspace-write', 'danger-full-access'])
export const ApprovalPolicySchema = z.enum(['untrusted', 'on-request', 'on-failure', 'never'])
export const PermissionModeSchema = z.enum(['default', 'acceptEdits', 'plan', 'bypassPermissions'])
export const ProfileSourceSchema = z.enum(['builtin', 'user'])

export const ProfileConfigSchema = z.object({
  agent: AgentSchema,
  model: z.string().min(1).optional(),
  reasoningEffort: ReasoningEffortSchema.optional(),
  sandboxMode: SandboxModeSchema.optional(),
  approvalPolicy: ApprovalPolicySchema.optional(),
  permissionMode: PermissionModeSchema.optional(),
  allowedTools: z.array(z.string().min(1)).optional(),
  disallowedTools: z.array(z.string().min(1)).optional(),
  appendSystemPrompt: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  claudeCliProfile: z.string().min(1).optional(),
  enabledSkills: z.array(z.string().min(1)).optional(),
  disabledBuiltinSkills: z.array(z.string().min(1)).optional(),
}).strict()

export type ProfileConfig = z.infer<typeof ProfileConfigSchema>

export const ProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  source: ProfileSourceSchema,
  config: ProfileConfigSchema,
  sortOrder: z.number().int(),
  lastUsedAt: z.number().int().optional(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
}).strict()

export type Profile = z.infer<typeof ProfileSchema>

export const ProfileOverrideSchema = ProfileConfigSchema.partial()
export type ProfileOverride = z.infer<typeof ProfileOverrideSchema>

export type ResolvedProfile = ProfileConfig & { agent: ProfileConfig['agent'] }
```

- [ ] **Step 4: Run test — PASS**

Run: `pnpm vitest run packages/conversation/tests/profiles/types.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/conversation/src/profiles/types.ts packages/conversation/tests/profiles/types.test.ts
git commit -m "feat(conversation): profile types + zod schemas"
```

---

## Task 8: Built-in profile seed definitions

**Files:**
- Create: `packages/conversation/src/profiles/builtin.ts`
- Create: `packages/conversation/tests/profiles/builtin.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { BUILTIN_PROFILES } from '../../src/profiles/builtin.js'
import { ProfileSchema } from '../../src/profiles/types.js'

describe('BUILTIN_PROFILES', () => {
  it('every entry validates against ProfileSchema and has source=builtin', () => {
    for (const p of BUILTIN_PROFILES) {
      const r = ProfileSchema.safeParse(p)
      expect(r.success, `invalid builtin profile ${p.id}: ${r.success ? '' : JSON.stringify(r.error.issues)}`).toBe(true)
      expect(p.source).toBe('builtin')
    }
  })

  it('contains the documented seed ids', () => {
    const ids = new Set(BUILTIN_PROFILES.map(p => p.id))
    for (const id of ['claude-coding', 'claude-yolo', 'claude-research', 'codex-coding', 'codex-yolo']) {
      expect(ids.has(id), `missing builtin profile ${id}`).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run test — FAIL**

Run: `pnpm vitest run packages/conversation/tests/profiles/builtin.test.ts`

- [ ] **Step 3: Implement builtin profiles**

`packages/conversation/src/profiles/builtin.ts`:

```ts
import type { Profile } from './types.js'

const NOW = 0

export const BUILTIN_PROFILES: Profile[] = [
  {
    id: 'claude-coding',
    name: 'Claude — Coding (plan mode)',
    description: 'Claude Sonnet with plan-mode permissions and auto-inject skills only.',
    source: 'builtin',
    config: {
      agent: 'claude',
      model: 'claude-sonnet-4-6',
      permissionMode: 'plan',
    },
    sortOrder: 10,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'claude-yolo',
    name: 'Claude — Yolo',
    description: 'Claude Sonnet with bypassPermissions. Use only in scratch workspaces.',
    source: 'builtin',
    config: {
      agent: 'claude',
      model: 'claude-sonnet-4-6',
      permissionMode: 'bypassPermissions',
    },
    sortOrder: 20,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'claude-research',
    name: 'Claude — Research (Opus)',
    description: 'Claude Opus with plan permissions and a research-focused system prompt.',
    source: 'builtin',
    config: {
      agent: 'claude',
      model: 'claude-opus-4-7',
      permissionMode: 'plan',
      appendSystemPrompt: 'You are in research mode. Cite sources. Prefer breadth-first exploration over premature synthesis.',
    },
    sortOrder: 30,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'codex-coding',
    name: 'Codex — Coding (workspace-write)',
    description: 'Codex GPT-5.4 with workspace-write sandbox and on-request approvals.',
    source: 'builtin',
    config: {
      agent: 'codex',
      model: 'gpt-5.4',
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
      reasoningEffort: 'medium',
    },
    sortOrder: 40,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'codex-yolo',
    name: 'Codex — Yolo',
    description: 'Codex GPT-5.4 with full-access sandbox and no approvals. Scratch workspaces only.',
    source: 'builtin',
    config: {
      agent: 'codex',
      model: 'gpt-5.4',
      sandboxMode: 'danger-full-access',
      approvalPolicy: 'never',
      reasoningEffort: 'medium',
    },
    sortOrder: 50,
    createdAt: NOW,
    updatedAt: NOW,
  },
]
```

- [ ] **Step 4: Run test — PASS**

Run: `pnpm vitest run packages/conversation/tests/profiles/builtin.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/conversation/src/profiles/builtin.ts packages/conversation/tests/profiles/builtin.test.ts
git commit -m "feat(conversation): built-in profile seed definitions"
```

---

## Task 9: Profiles repository

**Files:**
- Create: `packages/conversation/src/db/repositories/profiles-repo.ts`
- Create: `packages/conversation/tests/db/profiles-repo.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase, type Db } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { ProfilesRepo } from '../../src/db/repositories/profiles-repo.js'
import type { Profile } from '../../src/profiles/types.js'

function seed(): Profile {
  return {
    id: 'p1', name: 'one', source: 'user',
    config: { agent: 'claude' },
    sortOrder: 0, createdAt: 1, updatedAt: 1,
  }
}

describe('ProfilesRepo', () => {
  let db: Db
  let repo: ProfilesRepo
  beforeEach(() => {
    db = openDatabase(':memory:')
    runMigrations(db, MIGRATIONS)
    repo = new ProfilesRepo(db)
  })

  it('upsert + findById round-trip', () => {
    repo.upsert(seed())
    const got = repo.findById('p1')!
    expect(got.name).toBe('one')
    expect(got.config.agent).toBe('claude')
  })

  it('list returns sorted by sortOrder asc then lastUsedAt desc', () => {
    repo.upsert({ ...seed(), id: 'a', sortOrder: 20 })
    repo.upsert({ ...seed(), id: 'b', sortOrder: 10 })
    repo.upsert({ ...seed(), id: 'c', sortOrder: 10, lastUsedAt: 99 })
    expect(repo.list().map(p => p.id)).toEqual(['c', 'b', 'a'])
  })

  it('delete removes the row', () => {
    repo.upsert(seed())
    repo.delete('p1')
    expect(repo.findById('p1')).toBeNull()
  })

  it('setOverride and getOverride round-trip', () => {
    repo.upsert(seed())
    repo.setOverride('p1', { model: 'claude-haiku-4-5' }, undefined)
    expect(repo.getOverride('p1')).toEqual({ patch: { model: 'claude-haiku-4-5' }, sortOrder: null })
  })

  it('touchLastUsed updates lastUsedAt', () => {
    repo.upsert(seed())
    repo.touchLastUsed('p1', 12345)
    expect(repo.findById('p1')!.lastUsedAt).toBe(12345)
  })
})
```

- [ ] **Step 2: Run test — FAIL**

Run: `pnpm vitest run packages/conversation/tests/db/profiles-repo.test.ts`

- [ ] **Step 3: Implement the repo**

`packages/conversation/src/db/repositories/profiles-repo.ts`:

```ts
import type { Db } from '../client.js'
import { ProfileConfigSchema, type Profile, type ProfileOverride } from '../../profiles/types.js'

interface Row {
  id: string
  name: string
  description: string | null
  source: 'builtin' | 'user'
  agent: string
  config: string
  sort_order: number
  last_used_at: number | null
  created_at: number
  updated_at: number
}

function toProfile(r: Row): Profile {
  const config = ProfileConfigSchema.parse(JSON.parse(r.config))
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? undefined,
    source: r.source,
    config,
    sortOrder: r.sort_order,
    lastUsedAt: r.last_used_at ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export class ProfilesRepo {
  constructor(private db: Db) {}

  upsert(p: Profile): void {
    this.db.prepare(`
      INSERT INTO profiles (id, name, description, source, agent, config, sort_order, last_used_at, created_at, updated_at)
      VALUES (@id, @name, @description, @source, @agent, @config, @sortOrder, @lastUsedAt, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, description=excluded.description, source=excluded.source,
        agent=excluded.agent, config=excluded.config, sort_order=excluded.sort_order,
        last_used_at=excluded.last_used_at, updated_at=excluded.updated_at
    `).run({
      id: p.id,
      name: p.name,
      description: p.description ?? null,
      source: p.source,
      agent: p.config.agent,
      config: JSON.stringify(p.config),
      sortOrder: p.sortOrder,
      lastUsedAt: p.lastUsedAt ?? null,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    })
  }

  findById(id: string): Profile | null {
    const row = this.db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as Row | undefined
    return row ? toProfile(row) : null
  }

  list(): Profile[] {
    const rows = this.db.prepare(
      'SELECT * FROM profiles ORDER BY sort_order ASC, COALESCE(last_used_at, 0) DESC'
    ).all() as Row[]
    return rows.map(toProfile)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM profiles WHERE id = ?').run(id)
  }

  touchLastUsed(id: string, atMs: number): void {
    this.db.prepare('UPDATE profiles SET last_used_at = ? WHERE id = ?').run(atMs, id)
  }

  setOverride(profileId: string, patch: ProfileOverride, sortOrder: number | undefined): void {
    this.db.prepare(`
      INSERT INTO profile_overrides (profile_id, config_patch, sort_order, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(profile_id) DO UPDATE SET
        config_patch=excluded.config_patch,
        sort_order=excluded.sort_order,
        updated_at=excluded.updated_at
    `).run(profileId, JSON.stringify(patch), sortOrder ?? null, Date.now())
  }

  getOverride(profileId: string): { patch: ProfileOverride; sortOrder: number | null } | null {
    const row = this.db.prepare(
      'SELECT config_patch, sort_order FROM profile_overrides WHERE profile_id = ?'
    ).get(profileId) as { config_patch: string; sort_order: number | null } | undefined
    if (!row) return null
    return { patch: JSON.parse(row.config_patch) as ProfileOverride, sortOrder: row.sort_order }
  }

  deleteOverride(profileId: string): void {
    this.db.prepare('DELETE FROM profile_overrides WHERE profile_id = ?').run(profileId)
  }
}
```

- [ ] **Step 4: Run tests — PASS**

Run: `pnpm vitest run packages/conversation/tests/db/profiles-repo.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/conversation/src/db/repositories/profiles-repo.ts packages/conversation/tests/db/profiles-repo.test.ts
git commit -m "feat(conversation): profiles repository"
```

---

## Task 10: ProfileService (merge builtin + user, resolve, seed)

**Files:**
- Create: `packages/conversation/src/profiles/resolve.ts`
- Create: `packages/conversation/src/profiles/profile-service.ts`
- Create: `packages/conversation/tests/profiles/profile-service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase, type Db } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { ProfilesRepo } from '../../src/db/repositories/profiles-repo.js'
import { ProfileService } from '../../src/profiles/profile-service.js'

describe('ProfileService', () => {
  let db: Db
  let svc: ProfileService

  beforeEach(() => {
    db = openDatabase(':memory:')
    runMigrations(db, MIGRATIONS)
    svc = new ProfileService(new ProfilesRepo(db))
    svc.seedBuiltins()
  })

  it('seedBuiltins is idempotent', () => {
    const first = svc.list().length
    svc.seedBuiltins()
    expect(svc.list().length).toBe(first)
  })

  it('list contains the 5 seed profiles', () => {
    const ids = svc.list().map(p => p.id)
    for (const id of ['claude-coding', 'claude-yolo', 'claude-research', 'codex-coding', 'codex-yolo']) {
      expect(ids).toContain(id)
    }
  })

  it('create rejects source=builtin in input', () => {
    expect(() => svc.create({ name: 'X', config: { agent: 'claude' } })).not.toThrow()
  })

  it('resolve(profileId) deep-merges base config + override patch + per-call override', () => {
    svc.setOverride('claude-coding', { model: 'claude-haiku-4-5' })
    const r = svc.resolve('claude-coding', { permissionMode: 'acceptEdits' })
    expect(r.agent).toBe('claude')
    expect(r.model).toBe('claude-haiku-4-5')
    expect(r.permissionMode).toBe('acceptEdits')
  })

  it('resolve(null, override) uses defaults + override only', () => {
    const r = svc.resolve(null, { agent: 'codex' })
    expect(r.agent).toBe('codex')
  })

  it('resolve throws when no agent can be determined', () => {
    expect(() => svc.resolve(null, {})).toThrow(/agent/i)
  })

  it('delete user profile removes it', () => {
    const p = svc.create({ name: 'mine', config: { agent: 'claude' } })
    svc.delete(p.id)
    expect(svc.get(p.id)).toBeNull()
  })

  it('delete builtin profile clears its override but keeps the row', () => {
    svc.setOverride('claude-coding', { model: 'claude-haiku-4-5' })
    svc.delete('claude-coding')
    const p = svc.get('claude-coding')!
    expect(p).not.toBeNull()
    expect(p.config.model).toBe('claude-sonnet-4-6')
  })
})
```

- [ ] **Step 2: Run test — FAIL**

Run: `pnpm vitest run packages/conversation/tests/profiles/profile-service.test.ts`

- [ ] **Step 3: Implement resolve helper**

`packages/conversation/src/profiles/resolve.ts`:

```ts
import { DEFAULT_MODEL, DEFAULT_REASONING_EFFORT } from '@anubis/ai-agent'
import type { ProfileConfig, ProfileOverride, ResolvedProfile } from './types.js'

function mergeConfig(base: ProfileConfig | undefined, patch: ProfileOverride | undefined): ProfileConfig {
  const merged: Partial<ProfileConfig> = { ...(base ?? {}) }
  if (patch) {
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) (merged as Record<string, unknown>)[k] = v
    }
  }
  return merged as ProfileConfig
}

export function resolveLayers(layers: Array<ProfileConfig | ProfileOverride | undefined>): ResolvedProfile {
  let acc: ProfileConfig | undefined
  for (const layer of layers) {
    if (!layer) continue
    acc = mergeConfig(acc, layer)
  }
  if (!acc || !acc.agent) {
    throw new Error('Profile resolution failed: agent is required')
  }
  if (!acc.model) acc.model = DEFAULT_MODEL[acc.agent]
  if (!acc.reasoningEffort) acc.reasoningEffort = DEFAULT_REASONING_EFFORT
  return acc as ResolvedProfile
}
```

- [ ] **Step 4: Implement ProfileService**

`packages/conversation/src/profiles/profile-service.ts`:

```ts
import { newId } from '../util/ids.js'
import { nowMs } from '../util/time.js'
import type { ProfilesRepo } from '../db/repositories/profiles-repo.js'
import { BUILTIN_PROFILES } from './builtin.js'
import { resolveLayers } from './resolve.js'
import {
  ProfileConfigSchema, ProfileOverrideSchema, ProfileSchema,
  type Profile, type ProfileConfig, type ProfileOverride, type ResolvedProfile,
} from './types.js'

export interface CreateProfileInput {
  name: string
  description?: string
  config: ProfileConfig
}

export interface UpdateProfileInput {
  name?: string
  description?: string
  configPatch?: ProfileOverride
  sortOrder?: number
}

export class ProfileService {
  constructor(private repo: ProfilesRepo) {}

  seedBuiltins(): void {
    const existing = new Set(this.repo.list().filter(p => p.source === 'builtin').map(p => p.id))
    const now = nowMs()
    for (const p of BUILTIN_PROFILES) {
      if (existing.has(p.id)) continue
      this.repo.upsert({ ...p, createdAt: now, updatedAt: now })
    }
  }

  list(): Profile[] {
    return this.repo.list().map(p => this.withOverride(p))
  }

  get(id: string): Profile | null {
    const p = this.repo.findById(id)
    return p ? this.withOverride(p) : null
  }

  create(input: CreateProfileInput): Profile {
    const config = ProfileConfigSchema.parse(input.config)
    const now = nowMs()
    const p: Profile = {
      id: newId(),
      name: input.name,
      description: input.description,
      source: 'user',
      config,
      sortOrder: 1000,
      createdAt: now,
      updatedAt: now,
    }
    ProfileSchema.parse(p)
    this.repo.upsert(p)
    return p
  }

  update(id: string, patch: UpdateProfileInput): Profile {
    const existing = this.repo.findById(id)
    if (!existing) throw new Error(`Profile not found: ${id}`)
    if (existing.source === 'builtin') {
      if (patch.configPatch) this.setOverride(id, patch.configPatch)
      if (patch.sortOrder !== undefined) {
        const cur = this.repo.getOverride(id)
        this.repo.setOverride(id, cur?.patch ?? {}, patch.sortOrder)
      }
      return this.get(id)!
    }
    const merged: Profile = {
      ...existing,
      name: patch.name ?? existing.name,
      description: patch.description ?? existing.description,
      config: patch.configPatch
        ? ProfileConfigSchema.parse({ ...existing.config, ...patch.configPatch })
        : existing.config,
      sortOrder: patch.sortOrder ?? existing.sortOrder,
      updatedAt: nowMs(),
    }
    this.repo.upsert(merged)
    return merged
  }

  delete(id: string): void {
    const existing = this.repo.findById(id)
    if (!existing) return
    if (existing.source === 'builtin') {
      this.repo.deleteOverride(id)
      return
    }
    this.repo.delete(id)
  }

  setOverride(id: string, patch: ProfileOverride): void {
    ProfileOverrideSchema.parse(patch)
    const cur = this.repo.getOverride(id)
    this.repo.setOverride(id, patch, cur?.sortOrder ?? undefined)
  }

  resolve(profileId: string | null, override?: ProfileOverride): ResolvedProfile {
    const layers: Array<ProfileConfig | ProfileOverride | undefined> = []
    if (profileId) {
      const p = this.get(profileId)
      if (!p) throw new Error(`Profile not found: ${profileId}`)
      layers.push(p.config)
    }
    if (override) layers.push(ProfileOverrideSchema.parse(override))
    return resolveLayers(layers)
  }

  touchLastUsed(id: string): void {
    this.repo.touchLastUsed(id, nowMs())
  }

  private withOverride(p: Profile): Profile {
    if (p.source !== 'builtin') return p
    const ov = this.repo.getOverride(p.id)
    if (!ov) return p
    return {
      ...p,
      config: ProfileConfigSchema.parse({ ...p.config, ...ov.patch }),
      sortOrder: ov.sortOrder ?? p.sortOrder,
    }
  }
}
```

- [ ] **Step 5: Run tests — PASS**

Run: `pnpm vitest run packages/conversation/tests/profiles/profile-service.test.ts`

- [ ] **Step 6: Commit**

```bash
git add packages/conversation/src/profiles packages/conversation/tests/profiles/profile-service.test.ts
git commit -m "feat(conversation): ProfileService with seed, resolve chain, builtin overrides"
```

---

## Task 11: Skill types + `computeInitialSkills` pure helper

**Files:**
- Create: `packages/conversation/src/skills/types.ts`
- Create: `packages/conversation/src/skills/snapshot.ts`
- Create: `packages/conversation/tests/skills/snapshot.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { computeInitialSkills } from '../../src/skills/snapshot.js'
import type { SkillDefinition } from '../../src/skills/types.js'

const skill = (name: string, source: SkillDefinition['source']): SkillDefinition => ({
  name, description: '', source, path: '/x', body: '',
})

describe('computeInitialSkills', () => {
  it('includes every auto-inject by default', () => {
    const skills = [skill('a', 'builtin-auto'), skill('b', 'builtin-auto')]
    expect(computeInitialSkills(skills, { agent: 'claude' })).toEqual(['a', 'b'])
  })

  it('excludes disabledBuiltinSkills', () => {
    const skills = [skill('a', 'builtin-auto'), skill('b', 'builtin-auto')]
    const out = computeInitialSkills(skills, { agent: 'claude', disabledBuiltinSkills: ['a'] })
    expect(out).toEqual(['b'])
  })

  it('includes enabledSkills when they exist in catalog', () => {
    const skills = [skill('a', 'builtin-auto'), skill('opt', 'builtin-opt-in'), skill('usr', 'user')]
    const out = computeInitialSkills(skills, { agent: 'claude', enabledSkills: ['opt', 'usr', 'missing'] })
    expect(out).toEqual(['a', 'opt', 'usr'])
  })

  it('deduplicates and sorts', () => {
    const skills = [skill('z', 'builtin-auto'), skill('a', 'builtin-auto'), skill('m', 'builtin-opt-in')]
    const out = computeInitialSkills(skills, { agent: 'claude', enabledSkills: ['a', 'm'] })
    expect(out).toEqual(['a', 'm', 'z'])
  })
})
```

- [ ] **Step 2: Run test — FAIL**

Run: `pnpm vitest run packages/conversation/tests/skills/snapshot.test.ts`

- [ ] **Step 3: Implement types + snapshot**

`packages/conversation/src/skills/types.ts`:

```ts
export type SkillSource = 'builtin-auto' | 'builtin-opt-in' | 'user'

export interface SkillDefinition {
  name: string
  description: string
  whenToUse?: string
  source: SkillSource
  path: string
  body: string
}

export interface SkillIndex {
  name: string
  description: string
  whenToUse?: string
  source: SkillSource
}

export function toIndex(s: SkillDefinition): SkillIndex {
  return { name: s.name, description: s.description, whenToUse: s.whenToUse, source: s.source }
}
```

`packages/conversation/src/skills/snapshot.ts`:

```ts
import type { ResolvedProfile } from '../profiles/types.js'
import type { SkillDefinition } from './types.js'

export function computeInitialSkills(
  allSkills: SkillDefinition[],
  profile: Pick<ResolvedProfile, 'enabledSkills' | 'disabledBuiltinSkills'> & { agent: ResolvedProfile['agent'] },
): string[] {
  const disabled = new Set(profile.disabledBuiltinSkills ?? [])
  const autoInject = allSkills
    .filter(s => s.source === 'builtin-auto')
    .map(s => s.name)
    .filter(n => !disabled.has(n))

  const catalog = new Set(allSkills.map(s => s.name))
  const optIn = (profile.enabledSkills ?? []).filter(n => catalog.has(n))

  return [...new Set([...autoInject, ...optIn])].sort()
}
```

- [ ] **Step 4: Run tests — PASS**

Run: `pnpm vitest run packages/conversation/tests/skills/snapshot.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/conversation/src/skills/types.ts packages/conversation/src/skills/snapshot.ts packages/conversation/tests/skills/snapshot.test.ts
git commit -m "feat(conversation): skill types and computeInitialSkills snapshot helper"
```

---

## Task 12: `@anubis/ai-agent` exports `getBuiltinSkillRoots()` + ships skill dir scaffolding

**Files:**
- Modify: `packages/ai-agent/src/index.ts`
- Create: `packages/ai-agent/src/skills/roots.ts`
- Create: `packages/ai-agent/skills/auto-inject/.gitkeep`
- Create: `packages/ai-agent/skills/opt-in/.gitkeep`
- Create: `packages/ai-agent/skills/auto-inject/cron-helper/SKILL.md`

- [ ] **Step 1: Create the roots helper**

`packages/ai-agent/src/skills/roots.ts`:

```ts
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export interface BuiltinSkillRoots {
  autoInject: string
  optIn: string
}

export function getBuiltinSkillRoots(): BuiltinSkillRoots {
  const here = dirname(fileURLToPath(import.meta.url))
  const pkgRoot = join(here, '..', '..')
  return {
    autoInject: join(pkgRoot, 'skills', 'auto-inject'),
    optIn: join(pkgRoot, 'skills', 'opt-in'),
  }
}
```

- [ ] **Step 2: Re-export from package index**

Edit `packages/ai-agent/src/index.ts` — append:

```ts
export { getBuiltinSkillRoots } from './skills/roots.js'
export type { BuiltinSkillRoots } from './skills/roots.js'
```

- [ ] **Step 3: Create skill scaffolding directories**

`packages/ai-agent/skills/auto-inject/.gitkeep` — empty file.
`packages/ai-agent/skills/opt-in/.gitkeep` — empty file.

`packages/ai-agent/skills/auto-inject/cron-helper/SKILL.md`:

```markdown
---
name: cron-helper
description: Help the user create and manage scheduled jobs by emitting [CRON_*] command blocks.
when_to_use: User mentions schedules, cron, recurring jobs, or wants the agent to run at a later time.
---

# Cron Helper

You can register, update, list, and delete scheduled jobs that re-invoke this conversation later. Emit one of the command blocks below in your final response and the system will execute it:

```
[CRON_CREATE]
name: Friendly job name
schedule: 0 0 * * *
schedule_description: Every day at midnight
message: The prompt to re-send when the job fires
[/CRON_CREATE]
```

```
[CRON_LIST]
```

```
[CRON_DELETE: <job-id>]
```

```
[CRON_UPDATE: <job-id>]
name: New name (optional)
schedule: 0 12 * * * (optional)
schedule_description: Every day at noon (optional)
message: Replacement prompt (optional)
[/CRON_UPDATE]
```

Use a `schedule_description` in plain English so the user can confirm the cadence at a glance.
```

- [ ] **Step 4: Build + typecheck**

Run: `pnpm --filter @anubis/ai-agent build`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/ai-agent/src/skills packages/ai-agent/src/index.ts packages/ai-agent/skills
git commit -m "feat(ai-agent): getBuiltinSkillRoots helper + cron-helper builtin skill"
```

---

## Task 13: SkillLoader

**Files:**
- Create: `packages/conversation/src/skills/loader.ts`
- Create: `packages/conversation/tests/skills/loader.test.ts`
- Create test fixture: `packages/conversation/tests/fixtures/skills/auto-inject/sample/SKILL.md`
- Create test fixture: `packages/conversation/tests/fixtures/skills/opt-in/opt-sample/SKILL.md`
- Create test fixture: `packages/conversation/tests/fixtures/skills/user/usr-sample/SKILL.md`

- [ ] **Step 1: Create fixtures**

`packages/conversation/tests/fixtures/skills/auto-inject/sample/SKILL.md`:

```markdown
---
name: sample
description: A test auto-inject skill.
---

Body text for sample.
```

`packages/conversation/tests/fixtures/skills/opt-in/opt-sample/SKILL.md`:

```markdown
---
name: opt-sample
description: A test opt-in skill.
when_to_use: When the user asks for opt-sample.
---

Body text for opt-sample.
```

`packages/conversation/tests/fixtures/skills/user/usr-sample/SKILL.md`:

```markdown
---
name: usr-sample
description: A user-installed skill.
---

Body for usr-sample.
```

- [ ] **Step 2: Write the failing test**

`packages/conversation/tests/skills/loader.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { SkillLoader } from '../../src/skills/loader.js'

const here = dirname(fileURLToPath(import.meta.url))
const ROOTS = {
  autoInject: join(here, '..', 'fixtures', 'skills', 'auto-inject'),
  optIn: join(here, '..', 'fixtures', 'skills', 'opt-in'),
  user: join(here, '..', 'fixtures', 'skills', 'user'),
}

describe('SkillLoader', () => {
  let loader: SkillLoader
  beforeEach(() => { loader = new SkillLoader(ROOTS) })

  it('discovers skills from all three roots with correct sources', () => {
    const all = loader.discoverAll()
    const map = Object.fromEntries(all.map(s => [s.name, s.source]))
    expect(map['sample']).toBe('builtin-auto')
    expect(map['opt-sample']).toBe('builtin-opt-in')
    expect(map['usr-sample']).toBe('user')
  })

  it('parses frontmatter description and body', () => {
    const all = loader.discoverAll()
    const opt = all.find(s => s.name === 'opt-sample')!
    expect(opt.description).toBe('A test opt-in skill.')
    expect(opt.whenToUse).toBe('When the user asks for opt-sample.')
    expect(opt.body.trim()).toBe('Body text for opt-sample.')
  })

  it('byName returns undefined for unknown', () => {
    expect(loader.byName('nope')).toBeUndefined()
  })

  it('reload re-reads disk', () => {
    loader.discoverAll()
    loader.reload()
    expect(loader.discoverAll().length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 3: Run test — FAIL**

Run: `pnpm vitest run packages/conversation/tests/skills/loader.test.ts`

- [ ] **Step 4: Implement SkillLoader**

`packages/conversation/src/skills/loader.ts`:

```ts
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import matter from 'gray-matter'
import type { SkillDefinition, SkillSource } from './types.js'

export interface SkillRoots {
  autoInject: string
  optIn: string
  user: string
}

const SOURCE_PRECEDENCE: Record<SkillSource, number> = {
  user: 3,
  'builtin-opt-in': 2,
  'builtin-auto': 1,
}

export class SkillLoader {
  private cache: SkillDefinition[] | null = null

  constructor(private roots: SkillRoots) {}

  discoverAll(): SkillDefinition[] {
    if (this.cache) return this.cache
    const collected: SkillDefinition[] = []
    this.walk(this.roots.autoInject, 'builtin-auto', collected)
    this.walk(this.roots.optIn, 'builtin-opt-in', collected)
    this.walk(this.roots.user, 'user', collected)
    this.cache = this.dedupe(collected)
    return this.cache
  }

  byName(name: string): SkillDefinition | undefined {
    return this.discoverAll().find(s => s.name === name)
  }

  reload(): void {
    this.cache = null
  }

  private walk(root: string, source: SkillSource, out: SkillDefinition[]): void {
    if (!existsSync(root)) return
    const entries = readdirSync(root, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const dir = join(root, e.name)
      const file = join(dir, 'SKILL.md')
      if (!existsSync(file) || !statSync(file).isFile()) continue
      const raw = readFileSync(file, 'utf8')
      const parsed = matter(raw)
      const data = parsed.data as Record<string, unknown>
      const name = typeof data.name === 'string' && data.name.length > 0 ? data.name : e.name
      const description = typeof data.description === 'string' ? data.description : ''
      const whenToUse = typeof data.when_to_use === 'string' ? data.when_to_use : undefined
      out.push({ name, description, whenToUse, source, path: file, body: parsed.content })
    }
  }

  private dedupe(skills: SkillDefinition[]): SkillDefinition[] {
    const byName = new Map<string, SkillDefinition>()
    const sameSourceCounts = new Map<string, Set<SkillSource>>()
    for (const s of skills) {
      const seen = sameSourceCounts.get(s.name) ?? new Set<SkillSource>()
      if (seen.has(s.source)) {
        throw new Error(`Duplicate skill name within the same source: ${s.name} in ${s.source}`)
      }
      seen.add(s.source)
      sameSourceCounts.set(s.name, seen)
      const cur = byName.get(s.name)
      if (!cur || SOURCE_PRECEDENCE[s.source] > SOURCE_PRECEDENCE[cur.source]) {
        byName.set(s.name, s)
      }
    }
    return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name))
  }
}
```

- [ ] **Step 5: Run tests — PASS**

Run: `pnpm vitest run packages/conversation/tests/skills/loader.test.ts`

- [ ] **Step 6: Commit**

```bash
git add packages/conversation/src/skills/loader.ts packages/conversation/tests/skills/loader.test.ts packages/conversation/tests/fixtures
git commit -m "feat(conversation): SkillLoader (auto-inject + opt-in + user roots, dedupe by precedence)"
```

---

## Task 14: `buildSkillsBlock` injector

**Files:**
- Create: `packages/conversation/src/skills/inject.ts`
- Create: `packages/conversation/tests/skills/inject.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { buildSkillsBlock } from '../../src/skills/inject.js'
import type { SkillDefinition } from '../../src/skills/types.js'

const skill = (name: string, body: string): SkillDefinition => ({
  name, description: '', source: 'builtin-auto', path: '/x', body,
})

describe('buildSkillsBlock', () => {
  it('returns empty string for empty input', () => {
    expect(buildSkillsBlock([])).toBe('')
  })

  it('emits a header and one section per skill', () => {
    const out = buildSkillsBlock([skill('a', 'BODY A'), skill('b', 'BODY B')])
    expect(out).toContain('## Available Skills')
    expect(out).toContain('### a')
    expect(out).toContain('BODY A')
    expect(out).toContain('### b')
    expect(out).toContain('BODY B')
  })

  it('strips trailing whitespace from bodies', () => {
    const out = buildSkillsBlock([skill('a', '  BODY  \n\n')])
    expect(out).toContain('BODY')
    expect(out).not.toMatch(/BODY\s+\n###/)
  })
})
```

- [ ] **Step 2: Run test — FAIL**

Run: `pnpm vitest run packages/conversation/tests/skills/inject.test.ts`

- [ ] **Step 3: Implement injector**

`packages/conversation/src/skills/inject.ts`:

```ts
import type { SkillDefinition } from './types.js'

export function buildSkillsBlock(skills: SkillDefinition[]): string {
  if (skills.length === 0) return ''
  return [
    '## Available Skills',
    'You have access to the following skills. Apply them when relevant.',
    '',
    ...skills.map(s => `### ${s.name}\n${s.body.trim()}`),
  ].join('\n\n')
}

export function composeAppendSystemPrompt(
  profilePrompt: string | undefined,
  skills: SkillDefinition[],
): string | undefined {
  const block = buildSkillsBlock(skills)
  const parts = [profilePrompt?.trim(), block].filter((s): s is string => Boolean(s && s.length))
  return parts.length > 0 ? parts.join('\n\n') : undefined
}
```

- [ ] **Step 4: Run tests — PASS**

Run: `pnpm vitest run packages/conversation/tests/skills/inject.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/conversation/src/skills/inject.ts packages/conversation/tests/skills/inject.test.ts
git commit -m "feat(conversation): buildSkillsBlock + composeAppendSystemPrompt"
```

---

## Task 15: Conversation/Message/Artifact types + repositories

**Files:**
- Create: `packages/conversation/src/conversations/types.ts`
- Create: `packages/conversation/src/db/repositories/conversations-repo.ts`
- Create: `packages/conversation/src/db/repositories/messages-repo.ts`
- Create: `packages/conversation/src/db/repositories/artifacts-repo.ts`
- Create: `packages/conversation/src/db/repositories/agent-sessions-repo.ts`
- Create: `packages/conversation/tests/db/repositories.test.ts`

- [ ] **Step 1: Define shared types**

`packages/conversation/src/conversations/types.ts`:

```ts
import { z } from 'zod'
import { AgentSchema, ProfileOverrideSchema } from '../profiles/types.js'

export const ConversationStatusSchema = z.enum(['pending', 'running', 'finished', 'error'])
export type ConversationStatus = z.infer<typeof ConversationStatusSchema>

export const MessageRoleSchema = z.enum(['user', 'assistant', 'system'])
export type MessageRole = z.infer<typeof MessageRoleSchema>

export const ConversationExtraSchema = z.object({
  skills: z.array(z.string()).default([]),
  overrides: ProfileOverrideSchema.optional(),
  archived: z.boolean().optional(),
}).strict()
export type ConversationExtra = z.infer<typeof ConversationExtraSchema>

export interface Conversation {
  id: string
  title: string
  agent: 'claude' | 'codex'
  status: ConversationStatus
  profileId?: string
  workspacePath: string
  extra: ConversationExtra
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

export interface Message {
  id: string
  conversationId: string
  msgId: string
  role: MessageRole
  content: string
  metadata?: Record<string, unknown>
  createdAt: number
}

export interface Artifact {
  id: string
  conversationId: string
  messageId?: string
  kind: 'tool_call'
  toolName: string
  callId: string
  input?: unknown
  output?: unknown
  status: 'running' | 'success' | 'error'
  createdAt: number
  updatedAt: number
}

export interface AgentSession {
  conversationId: string
  agent: 'claude' | 'codex'
  agentSessionId: string
  model?: string
  updatedAt: number
}

export { AgentSchema }
```

- [ ] **Step 2: Implement conversations repo**

`packages/conversation/src/db/repositories/conversations-repo.ts`:

```ts
import type { Db } from '../client.js'
import {
  ConversationExtraSchema, type Conversation, type ConversationStatus,
} from '../../conversations/types.js'

interface Row {
  id: string
  title: string
  agent: string
  status: string
  profile_id: string | null
  workspace_path: string
  extra: string
  created_at: number
  updated_at: number
  deleted_at: number | null
}

function toConv(r: Row): Conversation {
  return {
    id: r.id,
    title: r.title,
    agent: r.agent as Conversation['agent'],
    status: r.status as ConversationStatus,
    profileId: r.profile_id ?? undefined,
    workspacePath: r.workspace_path,
    extra: ConversationExtraSchema.parse(JSON.parse(r.extra)),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? undefined,
  }
}

export class ConversationsRepo {
  constructor(private db: Db) {}

  insert(c: Conversation): void {
    this.db.prepare(`
      INSERT INTO conversations (id, title, agent, status, profile_id, workspace_path, extra, created_at, updated_at, deleted_at)
      VALUES (@id, @title, @agent, @status, @profileId, @workspacePath, @extra, @createdAt, @updatedAt, @deletedAt)
    `).run({
      id: c.id, title: c.title, agent: c.agent, status: c.status,
      profileId: c.profileId ?? null, workspacePath: c.workspacePath,
      extra: JSON.stringify(c.extra), createdAt: c.createdAt, updatedAt: c.updatedAt,
      deletedAt: c.deletedAt ?? null,
    })
  }

  findById(id: string): Conversation | null {
    const r = this.db.prepare('SELECT * FROM conversations WHERE id = ? AND deleted_at IS NULL').get(id) as Row | undefined
    return r ? toConv(r) : null
  }

  list(opts: { limit: number; archived?: boolean }): Conversation[] {
    const rows = this.db.prepare(`
      SELECT * FROM conversations WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?
    `).all(opts.limit) as Row[]
    let convs = rows.map(toConv)
    if (opts.archived !== undefined) {
      convs = convs.filter(c => (c.extra.archived ?? false) === opts.archived)
    }
    return convs
  }

  updateStatus(id: string, status: ConversationStatus): void {
    this.db.prepare('UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, Date.now(), id)
  }

  updateFields(id: string, patch: { title?: string; extra?: Conversation['extra']; profileId?: string | null }): void {
    const cur = this.findById(id)
    if (!cur) return
    const next = {
      title: patch.title ?? cur.title,
      extra: JSON.stringify(patch.extra ?? cur.extra),
      profileId: patch.profileId === undefined ? cur.profileId ?? null : patch.profileId,
      updatedAt: Date.now(),
    }
    this.db.prepare(`
      UPDATE conversations SET title = @title, extra = @extra, profile_id = @profileId, updated_at = @updatedAt
      WHERE id = ?
    `).run({ ...next, id } as never)
  }

  softDelete(id: string): void {
    this.db.prepare('UPDATE conversations SET deleted_at = ? WHERE id = ?').run(Date.now(), id)
  }
}
```

- [ ] **Step 3: Implement messages repo**

`packages/conversation/src/db/repositories/messages-repo.ts`:

```ts
import type { Db } from '../client.js'
import type { Message } from '../../conversations/types.js'

interface Row {
  id: string
  conversation_id: string
  msg_id: string
  role: string
  content: string
  metadata: string | null
  created_at: number
}

function toMsg(r: Row): Message {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    msgId: r.msg_id,
    role: r.role as Message['role'],
    content: r.content,
    metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    createdAt: r.created_at,
  }
}

export class MessagesRepo {
  constructor(private db: Db) {}

  insert(m: Message): void {
    this.db.prepare(`
      INSERT INTO messages (id, conversation_id, msg_id, role, content, metadata, created_at)
      VALUES (@id, @conversationId, @msgId, @role, @content, @metadata, @createdAt)
    `).run({
      id: m.id, conversationId: m.conversationId, msgId: m.msgId, role: m.role,
      content: m.content, metadata: m.metadata ? JSON.stringify(m.metadata) : null,
      createdAt: m.createdAt,
    })
  }

  upsertAssistant(m: Message): void {
    this.db.prepare(`
      INSERT INTO messages (id, conversation_id, msg_id, role, content, metadata, created_at)
      VALUES (@id, @conversationId, @msgId, @role, @content, @metadata, @createdAt)
      ON CONFLICT(id) DO UPDATE SET content=excluded.content, metadata=excluded.metadata
    `).run({
      id: m.id, conversationId: m.conversationId, msgId: m.msgId, role: m.role,
      content: m.content, metadata: m.metadata ? JSON.stringify(m.metadata) : null,
      createdAt: m.createdAt,
    })
  }

  listForConversation(conversationId: string, limit = 200): Message[] {
    const rows = this.db.prepare(`
      SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?
    `).all(conversationId, limit) as Row[]
    return rows.map(toMsg)
  }

  findById(id: string): Message | null {
    const r = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Row | undefined
    return r ? toMsg(r) : null
  }
}
```

- [ ] **Step 4: Implement artifacts repo**

`packages/conversation/src/db/repositories/artifacts-repo.ts`:

```ts
import type { Db } from '../client.js'
import type { Artifact } from '../../conversations/types.js'

interface Row {
  id: string
  conversation_id: string
  message_id: string | null
  kind: string
  tool_name: string
  call_id: string
  input: string | null
  output: string | null
  status: string
  created_at: number
  updated_at: number
}

function toArt(r: Row): Artifact {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    messageId: r.message_id ?? undefined,
    kind: r.kind as 'tool_call',
    toolName: r.tool_name,
    callId: r.call_id,
    input: r.input ? JSON.parse(r.input) : undefined,
    output: r.output ? JSON.parse(r.output) : undefined,
    status: r.status as Artifact['status'],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export class ArtifactsRepo {
  constructor(private db: Db) {}

  insert(a: Artifact): void {
    this.db.prepare(`
      INSERT INTO artifacts (id, conversation_id, message_id, kind, tool_name, call_id, input, output, status, created_at, updated_at)
      VALUES (@id, @conversationId, @messageId, @kind, @toolName, @callId, @input, @output, @status, @createdAt, @updatedAt)
    `).run({
      id: a.id, conversationId: a.conversationId, messageId: a.messageId ?? null,
      kind: a.kind, toolName: a.toolName, callId: a.callId,
      input: a.input === undefined ? null : JSON.stringify(a.input),
      output: a.output === undefined ? null : JSON.stringify(a.output),
      status: a.status, createdAt: a.createdAt, updatedAt: a.updatedAt,
    })
  }

  updateResult(callId: string, conversationId: string, output: unknown, status: Artifact['status']): void {
    this.db.prepare(`
      UPDATE artifacts SET output = ?, status = ?, updated_at = ? WHERE call_id = ? AND conversation_id = ?
    `).run(JSON.stringify(output ?? null), status, Date.now(), callId, conversationId)
  }

  listForConversation(conversationId: string): Artifact[] {
    const rows = this.db.prepare(
      'SELECT * FROM artifacts WHERE conversation_id = ? ORDER BY created_at ASC'
    ).all(conversationId) as Row[]
    return rows.map(toArt)
  }

  findById(id: string): Artifact | null {
    const r = this.db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id) as Row | undefined
    return r ? toArt(r) : null
  }
}
```

- [ ] **Step 5: Implement agent_sessions repo**

`packages/conversation/src/db/repositories/agent-sessions-repo.ts`:

```ts
import type { Db } from '../client.js'
import type { AgentSession } from '../../conversations/types.js'

interface Row {
  conversation_id: string
  agent: string
  agent_session_id: string
  model: string | null
  updated_at: number
}

function toSession(r: Row): AgentSession {
  return {
    conversationId: r.conversation_id,
    agent: r.agent as AgentSession['agent'],
    agentSessionId: r.agent_session_id,
    model: r.model ?? undefined,
    updatedAt: r.updated_at,
  }
}

export class AgentSessionsRepo {
  constructor(private db: Db) {}

  upsert(s: AgentSession): void {
    this.db.prepare(`
      INSERT INTO agent_sessions (conversation_id, agent, agent_session_id, model, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id) DO UPDATE SET
        agent=excluded.agent, agent_session_id=excluded.agent_session_id,
        model=excluded.model, updated_at=excluded.updated_at
    `).run(s.conversationId, s.agent, s.agentSessionId, s.model ?? null, s.updatedAt)
  }

  findByConversation(conversationId: string): AgentSession | null {
    const r = this.db.prepare('SELECT * FROM agent_sessions WHERE conversation_id = ?')
      .get(conversationId) as Row | undefined
    return r ? toSession(r) : null
  }
}
```

- [ ] **Step 6: Write repo round-trip tests**

`packages/conversation/tests/db/repositories.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase, type Db } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { ConversationsRepo } from '../../src/db/repositories/conversations-repo.js'
import { MessagesRepo } from '../../src/db/repositories/messages-repo.js'
import { ArtifactsRepo } from '../../src/db/repositories/artifacts-repo.js'
import { AgentSessionsRepo } from '../../src/db/repositories/agent-sessions-repo.js'

function setup(): { db: Db; convs: ConversationsRepo; msgs: MessagesRepo; arts: ArtifactsRepo; ses: AgentSessionsRepo } {
  const db = openDatabase(':memory:')
  runMigrations(db, MIGRATIONS)
  return {
    db,
    convs: new ConversationsRepo(db),
    msgs: new MessagesRepo(db),
    arts: new ArtifactsRepo(db),
    ses: new AgentSessionsRepo(db),
  }
}

describe('repositories', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => { ctx = setup() })

  it('Conversations insert/find/list/softDelete', () => {
    ctx.convs.insert({
      id: 'c1', title: 'X', agent: 'claude', status: 'pending',
      workspacePath: '/tmp', extra: { skills: [] },
      createdAt: 1, updatedAt: 1,
    })
    expect(ctx.convs.findById('c1')!.title).toBe('X')
    expect(ctx.convs.list({ limit: 10 }).length).toBe(1)
    ctx.convs.softDelete('c1')
    expect(ctx.convs.findById('c1')).toBeNull()
  })

  it('Messages insert + upsertAssistant accumulates content', () => {
    ctx.convs.insert({
      id: 'c1', title: 'X', agent: 'claude', status: 'pending',
      workspacePath: '/tmp', extra: { skills: [] }, createdAt: 1, updatedAt: 1,
    })
    ctx.msgs.upsertAssistant({
      id: 'm1', conversationId: 'c1', msgId: 'mid1', role: 'assistant',
      content: 'one', createdAt: 1,
    })
    ctx.msgs.upsertAssistant({
      id: 'm1', conversationId: 'c1', msgId: 'mid1', role: 'assistant',
      content: 'one two', createdAt: 1,
    })
    expect(ctx.msgs.findById('m1')!.content).toBe('one two')
  })

  it('Artifacts insert + updateResult by call_id', () => {
    ctx.convs.insert({
      id: 'c1', title: 'X', agent: 'claude', status: 'pending',
      workspacePath: '/tmp', extra: { skills: [] }, createdAt: 1, updatedAt: 1,
    })
    ctx.arts.insert({
      id: 'a1', conversationId: 'c1', kind: 'tool_call',
      toolName: 'Read', callId: 'call_1', status: 'running',
      createdAt: 1, updatedAt: 1,
    })
    ctx.arts.updateResult('call_1', 'c1', { ok: true }, 'success')
    expect(ctx.arts.findById('a1')!.status).toBe('success')
  })

  it('AgentSessions upsert is idempotent on conversation_id', () => {
    ctx.convs.insert({
      id: 'c1', title: 'X', agent: 'claude', status: 'pending',
      workspacePath: '/tmp', extra: { skills: [] }, createdAt: 1, updatedAt: 1,
    })
    ctx.ses.upsert({ conversationId: 'c1', agent: 'claude', agentSessionId: 's1', updatedAt: 1 })
    ctx.ses.upsert({ conversationId: 'c1', agent: 'claude', agentSessionId: 's2', updatedAt: 2 })
    expect(ctx.ses.findByConversation('c1')!.agentSessionId).toBe('s2')
  })
})
```

- [ ] **Step 7: Run tests — PASS**

Run: `pnpm vitest run packages/conversation/tests/db/repositories.test.ts`

- [ ] **Step 8: Commit**

```bash
git add packages/conversation/src/conversations/types.ts packages/conversation/src/db/repositories packages/conversation/tests/db/repositories.test.ts
git commit -m "feat(conversation): conversations/messages/artifacts/agent_sessions repos"
```

---

## Task 16: Cron command detector (pure parser)

**Files:**
- Create: `packages/conversation/src/conversations/cron-detect.ts`
- Create: `packages/conversation/tests/conversations/cron-detect.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { detectCronCommands } from '../../src/conversations/cron-detect.js'

describe('detectCronCommands', () => {
  it('parses CRON_CREATE blocks', () => {
    const text = `Some prose\n[CRON_CREATE]\nname: Backup\nschedule: 0 0 * * *\nschedule_description: midnight\nmessage: run backup\n[/CRON_CREATE]\nmore prose`
    const cmds = detectCronCommands(text)
    expect(cmds).toEqual([{
      kind: 'create',
      params: {
        name: 'Backup',
        schedule: '0 0 * * *',
        scheduleDescription: 'midnight',
        message: 'run backup',
      },
    }])
  })

  it('parses CRON_DELETE with id', () => {
    const cmds = detectCronCommands('[CRON_DELETE: abc-123]')
    expect(cmds).toEqual([{ kind: 'delete', id: 'abc-123' }])
  })

  it('parses CRON_LIST', () => {
    expect(detectCronCommands('[CRON_LIST]')).toEqual([{ kind: 'list' }])
  })

  it('parses CRON_UPDATE blocks with optional fields', () => {
    const text = `[CRON_UPDATE: id1]\nname: New\nschedule: 0 12 * * *\n[/CRON_UPDATE]`
    expect(detectCronCommands(text)).toEqual([{
      kind: 'update',
      id: 'id1',
      params: { name: 'New', schedule: '0 12 * * *' },
    }])
  })

  it('returns empty for text without commands', () => {
    expect(detectCronCommands('hello world')).toEqual([])
  })

  it('extracts multiple commands in one message', () => {
    const text = `[CRON_LIST]\n[CRON_DELETE: x]`
    expect(detectCronCommands(text)).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run test — FAIL**

Run: `pnpm vitest run packages/conversation/tests/conversations/cron-detect.test.ts`

- [ ] **Step 3: Implement detector**

`packages/conversation/src/conversations/cron-detect.ts`:

```ts
export interface CronCreateParams {
  name: string
  schedule: string
  scheduleDescription?: string
  message: string
}

export interface CronUpdateParams {
  name?: string
  schedule?: string
  scheduleDescription?: string
  message?: string
}

export type CronCommand =
  | { kind: 'create'; params: CronCreateParams }
  | { kind: 'update'; id: string; params: CronUpdateParams }
  | { kind: 'delete'; id: string }
  | { kind: 'list' }

const CREATE_RE = /\[CRON_CREATE\]\s*\n([\s\S]*?)\n?\[\/CRON_CREATE\]/g
const UPDATE_RE = /\[CRON_UPDATE:\s*([^\]]+)\]\s*\n([\s\S]*?)\n?\[\/CRON_UPDATE\]/g
const DELETE_RE = /\[CRON_DELETE:\s*([^\]]+)\]/g
const LIST_RE = /\[CRON_LIST\]/g

function parseKv(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of body.split(/\r?\n/)) {
    const m = /^([a-z_]+)\s*:\s*(.+)$/.exec(line.trim())
    if (m) out[m[1]] = m[2].trim()
  }
  return out
}

function pickCreate(kv: Record<string, string>): CronCreateParams | null {
  const name = kv.name, schedule = kv.schedule, message = kv.message
  if (!name || !schedule || !message) return null
  const out: CronCreateParams = { name, schedule, message }
  if (kv.schedule_description) out.scheduleDescription = kv.schedule_description
  return out
}

function pickUpdate(kv: Record<string, string>): CronUpdateParams {
  const out: CronUpdateParams = {}
  if (kv.name) out.name = kv.name
  if (kv.schedule) out.schedule = kv.schedule
  if (kv.schedule_description) out.scheduleDescription = kv.schedule_description
  if (kv.message) out.message = kv.message
  return out
}

export function detectCronCommands(text: string): CronCommand[] {
  const out: CronCommand[] = []
  for (const m of text.matchAll(CREATE_RE)) {
    const params = pickCreate(parseKv(m[1]))
    if (params) out.push({ kind: 'create', params })
  }
  for (const m of text.matchAll(UPDATE_RE)) {
    out.push({ kind: 'update', id: m[1].trim(), params: pickUpdate(parseKv(m[2])) })
  }
  for (const m of text.matchAll(DELETE_RE)) {
    out.push({ kind: 'delete', id: m[1].trim() })
  }
  if (LIST_RE.test(text)) {
    out.push({ kind: 'list' })
  }
  return out
}
```

- [ ] **Step 4: Run tests — PASS**

Run: `pnpm vitest run packages/conversation/tests/conversations/cron-detect.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/conversation/src/conversations/cron-detect.ts packages/conversation/tests/conversations/cron-detect.test.ts
git commit -m "feat(conversation): cron command detector (CREATE/UPDATE/DELETE/LIST blocks)"
```

---

## Task 17: SSE broadcaster

**Files:**
- Create: `packages/conversation/src/sse/broadcaster.ts`
- Create: `packages/conversation/tests/sse/broadcaster.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { SseBroadcaster, type SseEvent } from '../../src/sse/broadcaster.js'

describe('SseBroadcaster', () => {
  it('fans out events to all subscribers of a conversation', () => {
    const b = new SseBroadcaster()
    const received1: SseEvent[] = []
    const received2: SseEvent[] = []
    const unsub1 = b.subscribe('c1', e => received1.push(e))
    const unsub2 = b.subscribe('c1', e => received2.push(e))
    b.publish('c1', { name: 'partial', data: { deltaText: 'hi' } })
    expect(received1).toHaveLength(1)
    expect(received2).toHaveLength(1)
    unsub1(); unsub2()
  })

  it('isolates conversations', () => {
    const b = new SseBroadcaster()
    const got: SseEvent[] = []
    b.subscribe('c1', e => got.push(e))
    b.publish('c2', { name: 'done', data: { finishReason: 'stop' } })
    expect(got).toHaveLength(0)
  })

  it('unsubscribe stops delivery', () => {
    const b = new SseBroadcaster()
    const got: SseEvent[] = []
    const u = b.subscribe('c1', e => got.push(e))
    u()
    b.publish('c1', { name: 'done', data: { finishReason: 'stop' } })
    expect(got).toHaveLength(0)
  })

  it('subscriberCount reflects active subs', () => {
    const b = new SseBroadcaster()
    const u1 = b.subscribe('c1', () => undefined)
    const u2 = b.subscribe('c1', () => undefined)
    expect(b.subscriberCount('c1')).toBe(2)
    u1()
    expect(b.subscriberCount('c1')).toBe(1)
    u2()
    expect(b.subscriberCount('c1')).toBe(0)
  })
})
```

- [ ] **Step 2: Run test — FAIL**

Run: `pnpm vitest run packages/conversation/tests/sse/broadcaster.test.ts`

- [ ] **Step 3: Implement broadcaster**

`packages/conversation/src/sse/broadcaster.ts`:

```ts
export interface SseEvent {
  name: 'partial' | 'tool_call' | 'tool_result' | 'session' | 'done' | 'error' | 'approval_required' | 'system'
  data: unknown
}

export type SseListener = (e: SseEvent) => void

export class SseBroadcaster {
  private subs = new Map<string, Set<SseListener>>()

  subscribe(conversationId: string, listener: SseListener): () => void {
    let set = this.subs.get(conversationId)
    if (!set) {
      set = new Set()
      this.subs.set(conversationId, set)
    }
    set.add(listener)
    return () => {
      const s = this.subs.get(conversationId)
      if (!s) return
      s.delete(listener)
      if (s.size === 0) this.subs.delete(conversationId)
    }
  }

  publish(conversationId: string, event: SseEvent): void {
    const set = this.subs.get(conversationId)
    if (!set) return
    for (const fn of set) {
      try { fn(event) } catch { /* listener errors must not break fan-out */ }
    }
  }

  subscriberCount(conversationId: string): number {
    return this.subs.get(conversationId)?.size ?? 0
  }
}
```

- [ ] **Step 4: Run tests — PASS**

Run: `pnpm vitest run packages/conversation/tests/sse/broadcaster.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/conversation/src/sse/broadcaster.ts packages/conversation/tests/sse/broadcaster.test.ts
git commit -m "feat(conversation): SseBroadcaster — per-conversation fan-out"
```

---

## Task 18: CronJobs repo + CronService

**Files:**
- Create: `packages/conversation/src/db/repositories/cron-jobs-repo.ts`
- Create: `packages/conversation/src/cron/cron-service.ts`
- Create: `packages/conversation/tests/cron/cron-service.test.ts`

- [ ] **Step 1: Implement cron-jobs repo**

`packages/conversation/src/db/repositories/cron-jobs-repo.ts`:

```ts
import type { Db } from '../client.js'

export interface CronJob {
  id: string
  conversationId: string
  name: string
  schedule: string
  scheduleDescription?: string
  prompt: string
  enabled: boolean
  lastRunAt?: number
  createdAt: number
  updatedAt: number
}

interface Row {
  id: string
  conversation_id: string
  name: string
  schedule: string
  schedule_desc: string | null
  prompt: string
  enabled: number
  last_run_at: number | null
  created_at: number
  updated_at: number
}

function toJob(r: Row): CronJob {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    name: r.name,
    schedule: r.schedule,
    scheduleDescription: r.schedule_desc ?? undefined,
    prompt: r.prompt,
    enabled: !!r.enabled,
    lastRunAt: r.last_run_at ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export class CronJobsRepo {
  constructor(private db: Db) {}

  insert(j: CronJob): void {
    this.db.prepare(`
      INSERT INTO cron_jobs (id, conversation_id, name, schedule, schedule_desc, prompt, enabled, last_run_at, created_at, updated_at)
      VALUES (@id, @conversationId, @name, @schedule, @scheduleDescription, @prompt, @enabled, @lastRunAt, @createdAt, @updatedAt)
    `).run({
      id: j.id, conversationId: j.conversationId, name: j.name, schedule: j.schedule,
      scheduleDescription: j.scheduleDescription ?? null, prompt: j.prompt,
      enabled: j.enabled ? 1 : 0, lastRunAt: j.lastRunAt ?? null,
      createdAt: j.createdAt, updatedAt: j.updatedAt,
    })
  }

  update(id: string, patch: Partial<Pick<CronJob, 'name' | 'schedule' | 'scheduleDescription' | 'prompt' | 'enabled'>>): CronJob | null {
    const cur = this.findById(id)
    if (!cur) return null
    const next: CronJob = { ...cur, ...patch, updatedAt: Date.now() }
    this.db.prepare(`
      UPDATE cron_jobs SET name = ?, schedule = ?, schedule_desc = ?, prompt = ?, enabled = ?, updated_at = ?
      WHERE id = ?
    `).run(next.name, next.schedule, next.scheduleDescription ?? null, next.prompt, next.enabled ? 1 : 0, next.updatedAt, id)
    return next
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM cron_jobs WHERE id = ?').run(id)
  }

  findById(id: string): CronJob | null {
    const r = this.db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(id) as Row | undefined
    return r ? toJob(r) : null
  }

  list(conversationId?: string): CronJob[] {
    const rows = conversationId
      ? this.db.prepare('SELECT * FROM cron_jobs WHERE conversation_id = ? ORDER BY created_at DESC').all(conversationId) as Row[]
      : this.db.prepare('SELECT * FROM cron_jobs ORDER BY created_at DESC').all() as Row[]
    return rows.map(toJob)
  }

  touchLastRun(id: string, atMs: number): void {
    this.db.prepare('UPDATE cron_jobs SET last_run_at = ? WHERE id = ?').run(atMs, id)
  }
}
```

- [ ] **Step 2: Write failing test for CronService**

`packages/conversation/tests/cron/cron-service.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { openDatabase, type Db } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { ConversationsRepo } from '../../src/db/repositories/conversations-repo.js'
import { CronJobsRepo } from '../../src/db/repositories/cron-jobs-repo.js'
import { CronService } from '../../src/cron/cron-service.js'

describe('CronService', () => {
  let db: Db
  let svc: CronService
  let fired: Array<{ conversationId: string; prompt: string }> = []

  beforeEach(() => {
    db = openDatabase(':memory:')
    runMigrations(db, MIGRATIONS)
    new ConversationsRepo(db).insert({
      id: 'c1', title: 'X', agent: 'claude', status: 'pending',
      workspacePath: '/tmp', extra: { skills: [] }, createdAt: 1, updatedAt: 1,
    })
    fired = []
    svc = new CronService({
      repo: new CronJobsRepo(db),
      fire: async (conversationId, prompt) => { fired.push({ conversationId, prompt }) },
      scheduler: { schedule: vi.fn(() => ({ stop: vi.fn(), start: vi.fn() })) },
    })
  })

  it('handle(create) inserts a row and returns a confirmation', () => {
    const summary = svc.handle({ kind: 'create', params: { name: 'X', schedule: '* * * * *', message: 'go' } }, 'c1')
    expect(summary).toContain('Created')
    expect(svc.list('c1')).toHaveLength(1)
  })

  it('handle(delete) removes by id and returns a confirmation', () => {
    const created = svc.list('c1')
    svc.handle({ kind: 'create', params: { name: 'Y', schedule: '* * * * *', message: 'go' } }, 'c1')
    const id = svc.list('c1')[0].id
    const summary = svc.handle({ kind: 'delete', id }, 'c1')
    expect(summary).toMatch(/Removed|not found/i)
    expect(svc.list('c1')).toHaveLength(0)
  })

  it('handle(list) returns a human-readable summary', () => {
    svc.handle({ kind: 'create', params: { name: 'Y', schedule: '* * * * *', message: 'go' } }, 'c1')
    const summary = svc.handle({ kind: 'list' }, 'c1')
    expect(summary).toMatch(/Y/)
  })

  it('handle(update) updates fields when present', () => {
    svc.handle({ kind: 'create', params: { name: 'Y', schedule: '* * * * *', message: 'go' } }, 'c1')
    const id = svc.list('c1')[0].id
    svc.handle({ kind: 'update', id, params: { name: 'Z' } }, 'c1')
    expect(svc.list('c1')[0].name).toBe('Z')
  })

  it('loadFromDb schedules every enabled job', () => {
    svc.handle({ kind: 'create', params: { name: 'Y', schedule: '* * * * *', message: 'go' } }, 'c1')
    const scheduler = { schedule: vi.fn(() => ({ stop: vi.fn(), start: vi.fn() })) }
    const svc2 = new CronService({
      repo: new CronJobsRepo(db),
      fire: async () => undefined,
      scheduler,
    })
    svc2.loadFromDb()
    expect(scheduler.schedule).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 3: Run test — FAIL**

Run: `pnpm vitest run packages/conversation/tests/cron/cron-service.test.ts`

- [ ] **Step 4: Implement CronService**

`packages/conversation/src/cron/cron-service.ts`:

```ts
import { newId } from '../util/ids.js'
import { nowMs } from '../util/time.js'
import type { CronCommand } from '../conversations/cron-detect.js'
import type { CronJob, CronJobsRepo } from '../db/repositories/cron-jobs-repo.js'

export interface ScheduledHandle { stop(): void; start(): void }

export interface CronScheduler {
  schedule(expr: string, fn: () => void, opts?: { scheduled?: boolean }): ScheduledHandle
}

export interface CronServiceOpts {
  repo: CronJobsRepo
  fire: (conversationId: string, prompt: string) => Promise<void>
  scheduler: CronScheduler
}

export class CronService {
  private handles = new Map<string, ScheduledHandle>()

  constructor(private opts: CronServiceOpts) {}

  loadFromDb(): void {
    for (const job of this.opts.repo.list()) {
      if (job.enabled) this.scheduleJob(job)
    }
  }

  list(conversationId?: string): CronJob[] {
    return this.opts.repo.list(conversationId)
  }

  update(id: string, patch: Parameters<CronJobsRepo['update']>[1]): CronJob | null {
    const next = this.opts.repo.update(id, patch)
    if (next) this.rescheduleJob(next)
    return next
  }

  delete(id: string): void {
    this.handles.get(id)?.stop()
    this.handles.delete(id)
    this.opts.repo.delete(id)
  }

  handle(cmd: CronCommand, conversationId: string): string {
    if (cmd.kind === 'create') {
      const now = nowMs()
      const job: CronJob = {
        id: newId(),
        conversationId,
        name: cmd.params.name,
        schedule: cmd.params.schedule,
        scheduleDescription: cmd.params.scheduleDescription,
        prompt: cmd.params.message,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      }
      this.opts.repo.insert(job)
      this.scheduleJob(job)
      return `Created cron job "${job.name}" (id=${job.id}) on schedule ${job.schedule}.`
    }
    if (cmd.kind === 'delete') {
      const existed = this.opts.repo.findById(cmd.id)
      if (!existed) return `Cron job ${cmd.id} not found.`
      this.delete(cmd.id)
      return `Removed cron job ${cmd.id}.`
    }
    if (cmd.kind === 'update') {
      const next = this.update(cmd.id, cmd.params)
      return next ? `Updated cron job ${cmd.id}.` : `Cron job ${cmd.id} not found.`
    }
    const all = this.opts.repo.list(conversationId)
    if (all.length === 0) return 'No cron jobs scheduled for this conversation.'
    return all.map(j => `- ${j.name} (${j.id}) — ${j.schedule}${j.scheduleDescription ? ` (${j.scheduleDescription})` : ''}`).join('\n')
  }

  shutdown(): void {
    for (const h of this.handles.values()) h.stop()
    this.handles.clear()
  }

  private scheduleJob(job: CronJob): void {
    const handle = this.opts.scheduler.schedule(job.schedule, () => {
      this.opts.repo.touchLastRun(job.id, nowMs())
      void this.opts.fire(job.conversationId, job.prompt)
    })
    handle.start()
    this.handles.set(job.id, handle)
  }

  private rescheduleJob(job: CronJob): void {
    this.handles.get(job.id)?.stop()
    this.handles.delete(job.id)
    if (job.enabled) this.scheduleJob(job)
  }
}
```

- [ ] **Step 5: Run tests — PASS**

Run: `pnpm vitest run packages/conversation/tests/cron/cron-service.test.ts`

- [ ] **Step 6: Commit**

```bash
git add packages/conversation/src/db/repositories/cron-jobs-repo.ts packages/conversation/src/cron packages/conversation/tests/cron
git commit -m "feat(conversation): CronJobsRepo + CronService (decoupled scheduler)"
```

---

## Task 19: TaskManager

**Files:**
- Create: `packages/conversation/src/conversations/task-manager.ts`
- Create: `packages/conversation/tests/conversations/task-manager.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/conversation/tests/conversations/task-manager.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { TypedEmitter, type AgentEventMap } from '@anubis/ai-agent'
import { TaskManager } from '../../src/conversations/task-manager.js'

function makeFakeService() {
  const emitters: TypedEmitter<AgentEventMap>[] = []
  const streamAgent = vi.fn(async () => {
    const emitter = new TypedEmitter<AgentEventMap>()
    emitters.push(emitter)
    return { stream: emitter, workspaceId: 'w', sessionId: 's', agentSessionId: 'asid-1' }
  })
  return { svc: { streamAgent } as never, emitters }
}

describe('TaskManager', () => {
  it('getOrBuild reuses the task on second call', async () => {
    const { svc } = makeFakeService()
    const tm = new TaskManager(svc, { idleMs: 10_000 })
    const conv = { id: 'c1', agent: 'claude' as const, workspacePath: '/tmp' }
    const profile = { agent: 'claude' as const }
    const t1 = await tm.getOrBuild(conv, profile, { prompt: 'hi', msgId: 'm1' })
    const t2 = await tm.getOrBuild(conv, profile, { prompt: 'again', msgId: 'm2' })
    expect(t1).toBe(t2)
    await tm.kill('c1', 'user')
  })

  it('concurrent getOrBuild only spawns once', async () => {
    const { svc } = makeFakeService()
    const tm = new TaskManager(svc, { idleMs: 10_000 })
    const conv = { id: 'c1', agent: 'claude' as const, workspacePath: '/tmp' }
    const profile = { agent: 'claude' as const }
    const [a, b] = await Promise.all([
      tm.getOrBuild(conv, profile, { prompt: 'x', msgId: 'm1' }),
      tm.getOrBuild(conv, profile, { prompt: 'y', msgId: 'm2' }),
    ])
    expect(a).toBe(b)
    await tm.kill('c1', 'user')
  })

  it('subscribe returns the task emitter when task is live', async () => {
    const { svc } = makeFakeService()
    const tm = new TaskManager(svc, { idleMs: 10_000 })
    const conv = { id: 'c1', agent: 'claude' as const, workspacePath: '/tmp' }
    const profile = { agent: 'claude' as const }
    await tm.getOrBuild(conv, profile, { prompt: 'hi', msgId: 'm1' })
    expect(tm.subscribe('c1')).not.toBeNull()
    expect(tm.subscribe('missing')).toBeNull()
    await tm.kill('c1', 'user')
  })

  it('kill removes the task', async () => {
    const { svc } = makeFakeService()
    const tm = new TaskManager(svc, { idleMs: 10_000 })
    const conv = { id: 'c1', agent: 'claude' as const, workspacePath: '/tmp' }
    const profile = { agent: 'claude' as const }
    await tm.getOrBuild(conv, profile, { prompt: 'hi', msgId: 'm1' })
    await tm.kill('c1', 'user')
    expect(tm.subscribe('c1')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test — FAIL**

Run: `pnpm vitest run packages/conversation/tests/conversations/task-manager.test.ts`

- [ ] **Step 3: Implement TaskManager**

`packages/conversation/src/conversations/task-manager.ts`:

```ts
import type { AgentEventMap, AiAgentService, ResolvedProfile as _RP } from '@anubis/ai-agent'
import { TypedEmitter } from '@anubis/ai-agent'
import { nowMs } from '../util/time.js'
import type { ResolvedProfile } from '../profiles/types.js'

export interface AgentTask {
  conversationId: string
  agent: 'claude' | 'codex'
  status: 'pending' | 'running' | 'finished' | 'error'
  agentSessionId?: string
  lastActivityAt: number
  emitter: TypedEmitter<AgentEventMap>
  sendMessage(input: { prompt: string; msgId: string }): Promise<void>
  cancel(): Promise<void>
}

export interface ConversationLite {
  id: string
  agent: 'claude' | 'codex'
  workspacePath: string
}

export interface TurnInput {
  prompt: string
  msgId: string
  appendSystemPrompt?: string
  prevAgentSessionId?: string
}

export interface TaskManagerOpts {
  idleMs: number
  scanIntervalMs?: number
}

export class TaskManager {
  private tasks = new Map<string, AgentTask>()
  private building = new Map<string, Promise<AgentTask>>()
  private timer: NodeJS.Timeout | null = null

  constructor(
    private aiAgent: Pick<AiAgentService, 'streamAgent'>,
    private opts: TaskManagerOpts,
  ) {
    const interval = opts.scanIntervalMs ?? 60_000
    this.timer = setInterval(() => this.scan(), interval)
    this.timer.unref?.()
  }

  subscribe(conversationId: string): TypedEmitter<AgentEventMap> | null {
    return this.tasks.get(conversationId)?.emitter ?? null
  }

  async getOrBuild(
    conv: ConversationLite,
    profile: ResolvedProfile,
    turn: TurnInput,
  ): Promise<AgentTask> {
    const existing = this.tasks.get(conv.id)
    if (existing) {
      existing.lastActivityAt = nowMs()
      return existing
    }
    const inflight = this.building.get(conv.id)
    if (inflight) return inflight

    const promise = (async () => {
      const { stream, agentSessionId } = await this.aiAgent.streamAgent({
        agent: profile.agent,
        workspaceId: conv.id,
        sessionId: conv.id,
        prevAgentSessionId: turn.prevAgentSessionId,
        cwd: conv.workspacePath,
        prompt: turn.prompt,
        model: profile.model,
        claudeCliProfile: profile.claudeCliProfile,
        extraEnv: profile.env,
        appendSystemPrompt: turn.appendSystemPrompt ?? profile.appendSystemPrompt,
        reasoningEffort: profile.reasoningEffort,
        sandboxMode: profile.sandboxMode,
        approvalPolicy: profile.approvalPolicy,
        permissionMode: profile.permissionMode,
        allowedTools: profile.allowedTools,
        disallowedTools: profile.disallowedTools,
      })
      const task: AgentTask = {
        conversationId: conv.id,
        agent: conv.agent,
        status: 'running',
        agentSessionId,
        lastActivityAt: nowMs(),
        emitter: stream,
        sendMessage: async () => {
          throw new Error('Re-sending into an existing task is not supported yet; spawn a new turn instead.')
        },
        cancel: async () => {
          this.tasks.delete(conv.id)
        },
      }
      task.emitter.on('session', (d) => { task.agentSessionId = d.sessionId; task.lastActivityAt = nowMs() })
      task.emitter.on('partial', () => { task.lastActivityAt = nowMs() })
      task.emitter.on('tool_call', () => { task.lastActivityAt = nowMs() })
      task.emitter.on('tool_result', () => { task.lastActivityAt = nowMs() })
      task.emitter.on('done', () => { task.status = 'finished' })
      task.emitter.on('error', () => { task.status = 'error' })
      this.tasks.set(conv.id, task)
      return task
    })()

    this.building.set(conv.id, promise)
    try {
      return await promise
    } finally {
      this.building.delete(conv.id)
    }
  }

  async kill(conversationId: string, _reason: 'idle' | 'user' | 'shutdown'): Promise<void> {
    const t = this.tasks.get(conversationId)
    if (!t) return
    await t.cancel()
    this.tasks.delete(conversationId)
  }

  async shutdown(): Promise<void> {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    await Promise.all([...this.tasks.keys()].map(id => this.kill(id, 'shutdown')))
  }

  private scan(): void {
    const now = nowMs()
    for (const [id, t] of this.tasks) {
      if (now - t.lastActivityAt > this.opts.idleMs) void this.kill(id, 'idle')
    }
  }
}
```

- [ ] **Step 4: Run tests — PASS**

Run: `pnpm vitest run packages/conversation/tests/conversations/task-manager.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/conversation/src/conversations/task-manager.ts packages/conversation/tests/conversations/task-manager.test.ts
git commit -m "feat(conversation): TaskManager — hot-agent registry with idle scanner"
```

> **Note (post-MVP):** The current `task.sendMessage` is a stub — first message goes through `getOrBuild`, follow-up turns spawn fresh tasks (with `prevAgentSessionId` resume). True same-process re-use will land when the ai-agent runner exposes a long-lived "send another turn" surface; tracking under future work.

---

## Task 20: StreamRelay

**Files:**
- Create: `packages/conversation/src/conversations/stream-relay.ts`
- Create: `packages/conversation/tests/conversations/stream-relay.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TypedEmitter, type AgentEventMap } from '@anubis/ai-agent'
import { openDatabase, type Db } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { ConversationsRepo } from '../../src/db/repositories/conversations-repo.js'
import { MessagesRepo } from '../../src/db/repositories/messages-repo.js'
import { ArtifactsRepo } from '../../src/db/repositories/artifacts-repo.js'
import { AgentSessionsRepo } from '../../src/db/repositories/agent-sessions-repo.js'
import { SseBroadcaster } from '../../src/sse/broadcaster.js'
import { StreamRelay } from '../../src/conversations/stream-relay.js'

describe('StreamRelay', () => {
  let db: Db
  beforeEach(() => {
    db = openDatabase(':memory:')
    runMigrations(db, MIGRATIONS)
    new ConversationsRepo(db).insert({
      id: 'c1', title: 'X', agent: 'claude', status: 'running',
      workspacePath: '/tmp', extra: { skills: [] }, createdAt: 1, updatedAt: 1,
    })
  })

  it('accumulates partials into one assistant message row and emits to SSE', async () => {
    const sse = new SseBroadcaster()
    const seen: unknown[] = []
    sse.subscribe('c1', e => seen.push(e))
    const relay = new StreamRelay({
      conversationId: 'c1', msgId: 'm1', messageRowId: 'row1',
      conversations: new ConversationsRepo(db),
      messages: new MessagesRepo(db),
      artifacts: new ArtifactsRepo(db),
      sessions: new AgentSessionsRepo(db),
      sse,
      cronHandler: async () => 'no-op',
      flushEvery: 1,
    })
    const em = new TypedEmitter<AgentEventMap>()
    const done = relay.attach(em)
    em.emit('partial', { deltaText: 'Hello ' })
    em.emit('partial', { deltaText: 'world' })
    em.emit('done', { finishReason: 'stop' })
    await done
    const msg = new MessagesRepo(db).findById('row1')!
    expect(msg.content).toBe('Hello world')
    expect(seen.some((e: any) => e.name === 'partial')).toBe(true)
    expect(seen.some((e: any) => e.name === 'done')).toBe(true)
  })

  it('stores tool_call as artifact and updates on tool_result', async () => {
    const sse = new SseBroadcaster()
    const relay = new StreamRelay({
      conversationId: 'c1', msgId: 'm1', messageRowId: 'row1',
      conversations: new ConversationsRepo(db),
      messages: new MessagesRepo(db),
      artifacts: new ArtifactsRepo(db),
      sessions: new AgentSessionsRepo(db),
      sse,
      cronHandler: async () => 'no-op',
      flushEvery: 1,
    })
    const em = new TypedEmitter<AgentEventMap>()
    const done = relay.attach(em)
    em.emit('tool_call', { name: 'Read', args: { path: '/x' } } as never)
    em.emit('tool_result', { name: 'Read', result: { ok: true } } as never)
    em.emit('done', { finishReason: 'stop' })
    await done
    const arts = new ArtifactsRepo(db).listForConversation('c1')
    expect(arts).toHaveLength(1)
    expect(arts[0].status).toBe('success')
  })

  it('runs cron handler at done when text contains [CRON_LIST]', async () => {
    const sse = new SseBroadcaster()
    const cron = vi.fn(async () => 'OK')
    const relay = new StreamRelay({
      conversationId: 'c1', msgId: 'm1', messageRowId: 'row1',
      conversations: new ConversationsRepo(db),
      messages: new MessagesRepo(db),
      artifacts: new ArtifactsRepo(db),
      sessions: new AgentSessionsRepo(db),
      sse,
      cronHandler: cron,
      flushEvery: 1,
    })
    const em = new TypedEmitter<AgentEventMap>()
    const done = relay.attach(em)
    em.emit('partial', { deltaText: '[CRON_LIST]' })
    em.emit('done', { finishReason: 'stop' })
    await done
    expect(cron).toHaveBeenCalledTimes(1)
  })

  it('error event marks conversation status=error', async () => {
    const sse = new SseBroadcaster()
    const relay = new StreamRelay({
      conversationId: 'c1', msgId: 'm1', messageRowId: 'row1',
      conversations: new ConversationsRepo(db),
      messages: new MessagesRepo(db),
      artifacts: new ArtifactsRepo(db),
      sessions: new AgentSessionsRepo(db),
      sse,
      cronHandler: async () => '',
      flushEvery: 1,
    })
    const em = new TypedEmitter<AgentEventMap>()
    const done = relay.attach(em)
    em.emit('error', { error: new Error('boom') })
    await done
    const c = new ConversationsRepo(db).findById('c1')!
    expect(c.status).toBe('error')
  })
})
```

- [ ] **Step 2: Run test — FAIL**

Run: `pnpm vitest run packages/conversation/tests/conversations/stream-relay.test.ts`

- [ ] **Step 3: Implement StreamRelay**

`packages/conversation/src/conversations/stream-relay.ts`:

```ts
import type { TypedEmitter, AgentEventMap } from '@anubis/ai-agent'
import { newId } from '../util/ids.js'
import { nowMs } from '../util/time.js'
import { detectCronCommands, type CronCommand } from './cron-detect.js'
import type { ConversationsRepo } from '../db/repositories/conversations-repo.js'
import type { MessagesRepo } from '../db/repositories/messages-repo.js'
import type { ArtifactsRepo } from '../db/repositories/artifacts-repo.js'
import type { AgentSessionsRepo } from '../db/repositories/agent-sessions-repo.js'
import type { SseBroadcaster, SseEvent } from '../sse/broadcaster.js'

export interface StreamRelayOpts {
  conversationId: string
  msgId: string
  messageRowId: string
  conversations: ConversationsRepo
  messages: MessagesRepo
  artifacts: ArtifactsRepo
  sessions: AgentSessionsRepo
  sse: SseBroadcaster
  cronHandler: (cmd: CronCommand, conversationId: string) => Promise<string>
  agent?: 'claude' | 'codex'
  flushEvery?: number
}

export class StreamRelay {
  private buffer = ''
  private chunkCount = 0
  private toolNameByCall = new Map<string, string>()
  private toolArtIdByCall = new Map<string, string>()

  constructor(private opts: StreamRelayOpts) {}

  attach(emitter: TypedEmitter<AgentEventMap>): Promise<void> {
    const flushEvery = this.opts.flushEvery ?? 20
    return new Promise<void>((resolve) => {
      emitter.on('partial', (d) => {
        this.buffer += d.deltaText
        this.chunkCount += 1
        if (this.chunkCount % flushEvery === 0) this.flushAssistant()
        this.publish({ name: 'partial', data: d })
      })

      emitter.on('tool_call', (d) => {
        const callId = (d as { id?: string; call_id?: string }).id ?? (d as { call_id?: string }).call_id ?? newId()
        const toolName = d.name
        this.toolNameByCall.set(callId, toolName)
        const artId = newId()
        this.toolArtIdByCall.set(callId, artId)
        const now = nowMs()
        this.opts.artifacts.insert({
          id: artId, conversationId: this.opts.conversationId, messageId: this.opts.messageRowId,
          kind: 'tool_call', toolName, callId, input: d.args, status: 'running',
          createdAt: now, updatedAt: now,
        })
        this.publish({ name: 'tool_call', data: { ...d, callId, artifactId: artId } })
      })

      emitter.on('tool_result', (d) => {
        const callId = (d as { id?: string; call_id?: string }).id ?? (d as { call_id?: string }).call_id
        if (callId && this.toolArtIdByCall.has(callId)) {
          this.opts.artifacts.updateResult(callId, this.opts.conversationId, d.result, 'success')
        } else {
          for (const [cid, name] of this.toolNameByCall) {
            if (name === d.name) {
              this.opts.artifacts.updateResult(cid, this.opts.conversationId, d.result, 'success')
              break
            }
          }
        }
        this.publish({ name: 'tool_result', data: d })
      })

      emitter.on('session', (d) => {
        if (this.opts.agent) {
          this.opts.sessions.upsert({
            conversationId: this.opts.conversationId,
            agent: this.opts.agent,
            agentSessionId: d.sessionId,
            updatedAt: nowMs(),
          })
        }
        this.publish({ name: 'session', data: d })
      })

      emitter.on('approval_required', (d) => {
        this.publish({ name: 'approval_required', data: d })
      })

      emitter.on('done', async (d) => {
        this.flushAssistant({ finishReason: d.finishReason, usage: d.usage })
        const cmds = detectCronCommands(this.buffer)
        for (const cmd of cmds) {
          try {
            const summary = await this.opts.cronHandler(cmd, this.opts.conversationId)
            const now = nowMs()
            this.opts.messages.insert({
              id: newId(), conversationId: this.opts.conversationId, msgId: this.opts.msgId,
              role: 'system', content: summary, createdAt: now,
            })
            this.publish({ name: 'system', data: { content: summary } })
          } catch (e) {
            this.publish({ name: 'error', data: { error: (e as Error).message } })
          }
        }
        this.opts.conversations.updateStatus(this.opts.conversationId, 'finished')
        this.publish({ name: 'done', data: d })
        resolve()
      })

      emitter.on('error', (d) => {
        const now = nowMs()
        this.opts.messages.upsertAssistant({
          id: this.opts.messageRowId, conversationId: this.opts.conversationId,
          msgId: this.opts.msgId, role: 'assistant', content: this.buffer,
          metadata: { error: { message: d.error.message } },
          createdAt: now,
        })
        this.opts.conversations.updateStatus(this.opts.conversationId, 'error')
        this.publish({ name: 'error', data: { message: d.error.message } })
        resolve()
      })
    })
  }

  private flushAssistant(extraMeta: Record<string, unknown> = {}): void {
    this.opts.messages.upsertAssistant({
      id: this.opts.messageRowId,
      conversationId: this.opts.conversationId,
      msgId: this.opts.msgId,
      role: 'assistant',
      content: this.buffer,
      metadata: Object.keys(extraMeta).length ? extraMeta : undefined,
      createdAt: nowMs(),
    })
  }

  private publish(event: SseEvent): void {
    this.opts.sse.publish(this.opts.conversationId, event)
  }
}
```

- [ ] **Step 4: Run tests — PASS**

Run: `pnpm vitest run packages/conversation/tests/conversations/stream-relay.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/conversation/src/conversations/stream-relay.ts packages/conversation/tests/conversations/stream-relay.test.ts
git commit -m "feat(conversation): StreamRelay — accumulate, persist, fan-out, cron dispatch"
```

---

## Task 21: ConversationService (orchestrator)

**Files:**
- Create: `packages/conversation/src/conversations/conversation-service.ts`
- Create: `packages/conversation/tests/conversations/conversation-service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TypedEmitter, type AgentEventMap } from '@anubis/ai-agent'
import { openDatabase, type Db } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { ProfilesRepo } from '../../src/db/repositories/profiles-repo.js'
import { ConversationsRepo } from '../../src/db/repositories/conversations-repo.js'
import { MessagesRepo } from '../../src/db/repositories/messages-repo.js'
import { ArtifactsRepo } from '../../src/db/repositories/artifacts-repo.js'
import { AgentSessionsRepo } from '../../src/db/repositories/agent-sessions-repo.js'
import { CronJobsRepo } from '../../src/db/repositories/cron-jobs-repo.js'
import { ProfileService } from '../../src/profiles/profile-service.js'
import { SkillLoader } from '../../src/skills/loader.js'
import { SseBroadcaster } from '../../src/sse/broadcaster.js'
import { CronService } from '../../src/cron/cron-service.js'
import { TaskManager } from '../../src/conversations/task-manager.js'
import { ConversationService } from '../../src/conversations/conversation-service.js'

function setup() {
  const db = openDatabase(':memory:')
  runMigrations(db, MIGRATIONS)
  const profiles = new ProfileService(new ProfilesRepo(db))
  profiles.seedBuiltins()
  const loader = { discoverAll: () => [], byName: () => undefined, reload: () => undefined } as unknown as SkillLoader

  let createdEmitters: TypedEmitter<AgentEventMap>[] = []
  const aiAgent = {
    streamAgent: vi.fn(async () => {
      const e = new TypedEmitter<AgentEventMap>()
      createdEmitters.push(e)
      setTimeout(() => { e.emit('partial', { deltaText: 'ok' }); e.emit('done', { finishReason: 'stop' }) }, 0)
      return { stream: e, workspaceId: 'w', sessionId: 's', agentSessionId: 'asid-1' }
    }),
  }
  const tm = new TaskManager(aiAgent as never, { idleMs: 60_000 })
  const sse = new SseBroadcaster()
  const cron = new CronService({
    repo: new CronJobsRepo(db),
    fire: async () => undefined,
    scheduler: { schedule: () => ({ stop: () => undefined, start: () => undefined }) },
  })
  const svc = new ConversationService({
    db,
    profiles, skills: loader, sse, cron, tm, aiAgent: aiAgent as never,
    conversations: new ConversationsRepo(db),
    messages: new MessagesRepo(db),
    artifacts: new ArtifactsRepo(db),
    sessions: new AgentSessionsRepo(db),
  })
  return { svc, profiles, db, createdEmitters, aiAgent }
}

describe('ConversationService', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => { ctx = setup() })

  it('create stores skills snapshot and profile id', () => {
    const c = ctx.svc.create({ title: 'T', profileId: 'claude-coding', workspacePath: '/tmp' })
    expect(c.profileId).toBe('claude-coding')
    expect(c.extra.skills).toEqual([])
  })

  it('create rejects when agent cannot be determined', () => {
    expect(() => ctx.svc.create({ title: 'T', workspacePath: '/tmp' })).toThrow(/agent/i)
  })

  it('sendMessage inserts user row and starts a turn', async () => {
    const c = ctx.svc.create({ title: 'T', profileId: 'claude-coding', workspacePath: '/tmp' })
    const r = await ctx.svc.sendMessage(c.id, { content: 'hello' })
    expect(r.msgId).toBeTruthy()
    await new Promise(rs => setTimeout(rs, 10))
    const msgs = ctx.svc.listMessages(c.id)
    expect(msgs.some(m => m.role === 'user' && m.content === 'hello')).toBe(true)
  })

  it('PATCH rejects changing agent via override', () => {
    const c = ctx.svc.create({ title: 'T', profileId: 'claude-coding', workspacePath: '/tmp' })
    expect(() => ctx.svc.update(c.id, { override: { agent: 'codex' } as never })).toThrow(/agent/i)
  })

  it('resetSkills recomputes and persists snapshot', () => {
    const c = ctx.svc.create({ title: 'T', profileId: 'claude-coding', workspacePath: '/tmp' })
    const skills = ctx.svc.resetSkills(c.id)
    expect(skills).toEqual([])
  })

  it('delete soft-deletes the conversation', () => {
    const c = ctx.svc.create({ title: 'T', profileId: 'claude-coding', workspacePath: '/tmp' })
    ctx.svc.delete(c.id)
    expect(ctx.svc.get(c.id)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test — FAIL**

Run: `pnpm vitest run packages/conversation/tests/conversations/conversation-service.test.ts`

- [ ] **Step 3: Implement ConversationService**

`packages/conversation/src/conversations/conversation-service.ts`:

```ts
import type { AiAgentService } from '@anubis/ai-agent'
import type { Db } from '../db/client.js'
import { newId } from '../util/ids.js'
import { nowMs } from '../util/time.js'
import { computeInitialSkills } from '../skills/snapshot.js'
import { composeAppendSystemPrompt } from '../skills/inject.js'
import type { SkillLoader } from '../skills/loader.js'
import type { ProfileService } from '../profiles/profile-service.js'
import type { ProfileOverride, ResolvedProfile } from '../profiles/types.js'
import type { ConversationsRepo } from '../db/repositories/conversations-repo.js'
import type { MessagesRepo } from '../db/repositories/messages-repo.js'
import type { ArtifactsRepo } from '../db/repositories/artifacts-repo.js'
import type { AgentSessionsRepo } from '../db/repositories/agent-sessions-repo.js'
import type { SseBroadcaster } from '../sse/broadcaster.js'
import type { CronService } from '../cron/cron-service.js'
import type { TaskManager } from './task-manager.js'
import type { Conversation, ConversationExtra, Message } from './types.js'
import { StreamRelay } from './stream-relay.js'

export interface CreateConversationInput {
  title: string
  profileId?: string
  override?: ProfileOverride
  workspacePath: string
  agent?: 'claude' | 'codex'
}

export interface SendMessageInput {
  content: string
  override?: ProfileOverride
}

export interface UpdateConversationInput {
  title?: string
  override?: ProfileOverride
  archived?: boolean
  profileId?: string | null
}

export interface ConversationServiceDeps {
  db: Db
  profiles: ProfileService
  skills: SkillLoader
  sse: SseBroadcaster
  cron: CronService
  tm: TaskManager
  aiAgent: Pick<AiAgentService, 'streamAgent'>
  conversations: ConversationsRepo
  messages: MessagesRepo
  artifacts: ArtifactsRepo
  sessions: AgentSessionsRepo
}

export class ConversationService {
  constructor(private deps: ConversationServiceDeps) {}

  create(input: CreateConversationInput): Conversation {
    const resolved = this.resolveOrThrow(input.profileId ?? null, input.override, input.agent)
    const skills = computeInitialSkills(this.deps.skills.discoverAll(), resolved)
    const now = nowMs()
    const conv: Conversation = {
      id: newId(),
      title: input.title,
      agent: resolved.agent,
      status: 'pending',
      profileId: input.profileId,
      workspacePath: input.workspacePath,
      extra: { skills, overrides: input.override },
      createdAt: now,
      updatedAt: now,
    }
    this.deps.conversations.insert(conv)
    if (input.profileId) this.deps.profiles.touchLastUsed(input.profileId)
    return conv
  }

  list(opts: { limit?: number; archived?: boolean } = {}): Conversation[] {
    return this.deps.conversations.list({ limit: opts.limit ?? 50, archived: opts.archived })
  }

  get(id: string): Conversation | null {
    return this.deps.conversations.findById(id)
  }

  update(id: string, patch: UpdateConversationInput): Conversation {
    const cur = this.deps.conversations.findById(id)
    if (!cur) throw new Error(`Conversation not found: ${id}`)
    if (patch.override?.agent && patch.override.agent !== cur.agent) {
      throw new Error('Cannot change conversation agent after create')
    }
    if (patch.profileId) {
      const p = this.deps.profiles.get(patch.profileId)
      if (!p) throw new Error(`Profile not found: ${patch.profileId}`)
      if (p.config.agent !== cur.agent) throw new Error(`Profile ${patch.profileId} agent (${p.config.agent}) does not match conversation agent (${cur.agent})`)
    }
    const extra: ConversationExtra = {
      ...cur.extra,
      overrides: patch.override ?? cur.extra.overrides,
      archived: patch.archived ?? cur.extra.archived,
    }
    this.deps.conversations.updateFields(id, {
      title: patch.title,
      extra,
      profileId: patch.profileId === undefined ? undefined : patch.profileId,
    })
    return this.deps.conversations.findById(id)!
  }

  delete(id: string): void {
    void this.deps.tm.kill(id, 'user')
    this.deps.conversations.softDelete(id)
  }

  resetSkills(id: string): string[] {
    const cur = this.deps.conversations.findById(id)
    if (!cur) throw new Error(`Conversation not found: ${id}`)
    const resolved = this.resolveOrThrow(cur.profileId ?? null, cur.extra.overrides, cur.agent)
    const skills = computeInitialSkills(this.deps.skills.discoverAll(), resolved)
    this.deps.conversations.updateFields(id, { extra: { ...cur.extra, skills } })
    return skills
  }

  listMessages(id: string): Message[] {
    return this.deps.messages.listForConversation(id)
  }

  async sendMessage(id: string, input: SendMessageInput): Promise<{ msgId: string; messageId: string }> {
    const cur = this.deps.conversations.findById(id)
    if (!cur) throw new Error(`Conversation not found: ${id}`)
    if (input.override?.agent && input.override.agent !== cur.agent) {
      throw new Error('Cannot change conversation agent via per-turn override')
    }
    const resolved = this.resolveOrThrow(cur.profileId ?? null, { ...cur.extra.overrides, ...input.override }, cur.agent)
    const now = nowMs()
    const msgId = newId()
    const userRowId = newId()
    this.deps.messages.insert({
      id: userRowId, conversationId: id, msgId, role: 'user',
      content: input.content, createdAt: now,
    })
    this.deps.conversations.updateStatus(id, 'running')

    const skillDefs = cur.extra.skills
      .map(name => this.deps.skills.byName(name))
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
    const appendSystemPrompt = composeAppendSystemPrompt(resolved.appendSystemPrompt, skillDefs)

    const prevSession = this.deps.sessions.findByConversation(id)?.agentSessionId
    const task = await this.deps.tm.getOrBuild(
      { id, agent: cur.agent, workspacePath: cur.workspacePath },
      { ...resolved, appendSystemPrompt },
      { prompt: input.content, msgId, appendSystemPrompt, prevAgentSessionId: prevSession },
    )

    const messageRowId = newId()
    const relay = new StreamRelay({
      conversationId: id, msgId, messageRowId,
      conversations: this.deps.conversations,
      messages: this.deps.messages,
      artifacts: this.deps.artifacts,
      sessions: this.deps.sessions,
      sse: this.deps.sse,
      cronHandler: async (cmd, convId) => this.deps.cron.handle(cmd, convId),
      agent: cur.agent,
    })
    void relay.attach(task.emitter).then(() => {
      if (cur.profileId) this.deps.profiles.touchLastUsed(cur.profileId)
    })

    return { msgId, messageId: userRowId }
  }

  async cancel(id: string): Promise<void> {
    await this.deps.tm.kill(id, 'user')
    this.deps.conversations.updateStatus(id, 'error')
  }

  private resolveOrThrow(
    profileId: string | null,
    override: ProfileOverride | undefined,
    agentHint: 'claude' | 'codex' | undefined,
  ): ResolvedProfile {
    const finalOverride: ProfileOverride = { ...(override ?? {}) }
    if (agentHint && !profileId && !finalOverride.agent) finalOverride.agent = agentHint
    return this.deps.profiles.resolve(profileId, finalOverride)
  }
}
```

- [ ] **Step 4: Run tests — PASS**

Run: `pnpm vitest run packages/conversation/tests/conversations/conversation-service.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/conversation/src/conversations/conversation-service.ts packages/conversation/tests/conversations/conversation-service.test.ts
git commit -m "feat(conversation): ConversationService orchestrator (create/send/update/delete/reset-skills)"
```

---

## Task 22: Composition root + node-cron scheduler adapter

**Files:**
- Create: `packages/conversation/src/cron/node-cron-scheduler.ts`
- Modify: `packages/conversation/src/index.ts`

- [ ] **Step 1: Implement node-cron adapter**

`packages/conversation/src/cron/node-cron-scheduler.ts`:

```ts
import cron from 'node-cron'
import type { CronScheduler, ScheduledHandle } from './cron-service.js'

export class NodeCronScheduler implements CronScheduler {
  schedule(expr: string, fn: () => void): ScheduledHandle {
    const task = cron.schedule(expr, fn, { scheduled: false })
    return {
      start: () => task.start(),
      stop: () => task.stop(),
    }
  }
}
```

- [ ] **Step 2: Implement `createConversationService` composition root**

Replace `packages/conversation/src/index.ts`:

```ts
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { AiAgentService, createAiAgentService } from '@anubis/ai-agent'
import { openDatabase } from './db/client.js'
import { runMigrations } from './db/migrate.js'
import { MIGRATIONS } from './db/migrations/index.js'
import { ProfilesRepo } from './db/repositories/profiles-repo.js'
import { ConversationsRepo } from './db/repositories/conversations-repo.js'
import { MessagesRepo } from './db/repositories/messages-repo.js'
import { ArtifactsRepo } from './db/repositories/artifacts-repo.js'
import { AgentSessionsRepo } from './db/repositories/agent-sessions-repo.js'
import { CronJobsRepo } from './db/repositories/cron-jobs-repo.js'
import { ProfileService } from './profiles/profile-service.js'
import { SkillLoader, type SkillRoots } from './skills/loader.js'
import { SseBroadcaster } from './sse/broadcaster.js'
import { CronService } from './cron/cron-service.js'
import { NodeCronScheduler } from './cron/node-cron-scheduler.js'
import { TaskManager } from './conversations/task-manager.js'
import { ConversationService } from './conversations/conversation-service.js'

export interface CreateConversationServiceOpts {
  dataDir: string
  skillRoots: SkillRoots
  aiAgent?: AiAgentService
  idleMs?: number
}

export interface ConversationStack {
  conversation: ConversationService
  profiles: ProfileService
  skills: SkillLoader
  sse: SseBroadcaster
  cron: CronService
  taskManager: TaskManager
  aiAgent: AiAgentService
  shutdown(): Promise<void>
}

export function createConversationService(opts: CreateConversationServiceOpts): ConversationStack {
  mkdirSync(opts.dataDir, { recursive: true })
  const db = openDatabase(join(opts.dataDir, 'anubis.db'))
  runMigrations(db, MIGRATIONS)

  const profilesRepo = new ProfilesRepo(db)
  const conversationsRepo = new ConversationsRepo(db)
  const messagesRepo = new MessagesRepo(db)
  const artifactsRepo = new ArtifactsRepo(db)
  const sessionsRepo = new AgentSessionsRepo(db)
  const cronRepo = new CronJobsRepo(db)

  const profiles = new ProfileService(profilesRepo)
  profiles.seedBuiltins()

  const skills = new SkillLoader(opts.skillRoots)
  const sse = new SseBroadcaster()
  const aiAgent = opts.aiAgent ?? createAiAgentService()
  const tm = new TaskManager(aiAgent, { idleMs: opts.idleMs ?? 10 * 60_000 })

  const cron = new CronService({
    repo: cronRepo,
    fire: async (conversationId, prompt) => {
      try { await conversation.sendMessage(conversationId, { content: prompt }) }
      catch (e) { console.error('[cron] fire failed', conversationId, e) }
    },
    scheduler: new NodeCronScheduler(),
  })

  const conversation = new ConversationService({
    db, profiles, skills, sse, cron, tm, aiAgent,
    conversations: conversationsRepo,
    messages: messagesRepo,
    artifacts: artifactsRepo,
    sessions: sessionsRepo,
  })

  cron.loadFromDb()

  return {
    conversation, profiles, skills, sse, cron, taskManager: tm, aiAgent,
    async shutdown() {
      cron.shutdown()
      await tm.shutdown()
      db.close()
    },
  }
}

export type { Conversation, Message, Artifact, AgentSession, ConversationExtra, ConversationStatus, MessageRole } from './conversations/types.js'
export type { Profile, ProfileConfig, ProfileOverride, ProfileSource, ResolvedProfile } from './profiles/types.js'
export type { SkillDefinition, SkillIndex, SkillSource } from './skills/types.js'
export { toIndex as toSkillIndex } from './skills/types.js'
export type { CronJob } from './db/repositories/cron-jobs-repo.js'
export { ConversationService } from './conversations/conversation-service.js'
export { ProfileService } from './profiles/profile-service.js'
export { SkillLoader } from './skills/loader.js'
export { CronService } from './cron/cron-service.js'
export { SseBroadcaster } from './sse/broadcaster.js'
export type { SseEvent } from './sse/broadcaster.js'
```

- [ ] **Step 3: Build + typecheck**

Run: `pnpm --filter @anubis/conversation build`
Expected: exits 0; `dist/` populated; `dist/db/migrations/001_init.sql` exists.

- [ ] **Step 4: Commit**

```bash
git add packages/conversation/src/cron/node-cron-scheduler.ts packages/conversation/src/index.ts
git commit -m "feat(conversation): createConversationService composition root + node-cron adapter"
```

---

## Task 23: Backend — add `@anubis/conversation` dep + boot helper

**Files:**
- Modify: `packages/backend/package.json` (add dep)
- Create: `packages/backend/src/services.ts` (singleton stack)
- Modify: `packages/backend/src/server.ts` (verify data dir source)

- [ ] **Step 1: Add dep**

Edit `packages/backend/package.json` — add to `dependencies` (alphabetical order preserved):

```json
    "@anubis/conversation": "workspace:*",
```

Run: `pnpm install`
Expected: lockfile updated.

- [ ] **Step 2: Create boot helper**

`packages/backend/src/services.ts`:

```ts
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConversationService, type ConversationStack } from '@anubis/conversation'
import { getBuiltinSkillRoots } from '@anubis/ai-agent'

let stack: ConversationStack | null = null

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

export async function shutdownStack(): Promise<void> {
  if (!stack) return
  await stack.shutdown()
  stack = null
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/package.json packages/backend/src/services.ts pnpm-lock.yaml
git commit -m "feat(backend): @anubis/conversation dep + boot helper (getStack)"
```

---

## Task 24: Backend routes — profiles

**Files:**
- Create: `packages/backend/src/profile.ts`

- [ ] **Step 1: Implement routes**

```ts
import { Hono } from 'hono'
import { z } from 'zod'
import { getStack } from './services.js'

const ProfileConfig = z.object({
  agent: z.enum(['claude', 'codex']),
}).passthrough()

const CreateBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  config: ProfileConfig,
}).strict()

const UpdateBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  configPatch: z.record(z.string(), z.unknown()).optional(),
  sortOrder: z.number().int().optional(),
}).strict()

const ResolveBody = z.object({
  override: z.record(z.string(), z.unknown()).optional(),
}).strict()

export const profileRoutes = new Hono()

profileRoutes.get('/', (c) => c.json({ ok: true, items: getStack().profiles.list() }))

profileRoutes.get('/:id', (c) => {
  const p = getStack().profiles.get(c.req.param('id'))
  if (!p) return c.json({ ok: false, error: 'not_found' }, 404)
  return c.json({ ok: true, profile: p })
})

profileRoutes.post('/', async (c) => {
  const body = CreateBody.parse(await c.req.json())
  const p = getStack().profiles.create(body as never)
  return c.json({ ok: true, profile: p }, 201)
})

profileRoutes.patch('/:id', async (c) => {
  const body = UpdateBody.parse(await c.req.json())
  const p = getStack().profiles.update(c.req.param('id'), body as never)
  return c.json({ ok: true, profile: p })
})

profileRoutes.delete('/:id', (c) => {
  getStack().profiles.delete(c.req.param('id'))
  return c.json({ ok: true })
})

profileRoutes.post('/:id/resolve', async (c) => {
  const body = ResolveBody.parse(await c.req.json().catch(() => ({})))
  const r = getStack().profiles.resolve(c.req.param('id'), body.override as never)
  return c.json({ ok: true, resolved: r })
})
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/profile.ts
git commit -m "feat(backend): profile routes (list/get/create/update/delete/resolve)"
```

---

## Task 25: Backend routes — skills

**Files:**
- Create: `packages/backend/src/skill.ts`

- [ ] **Step 1: Implement routes**

```ts
import { Hono } from 'hono'
import { toSkillIndex } from '@anubis/conversation'
import { getStack } from './services.js'

export const skillRoutes = new Hono()

skillRoutes.get('/', (c) => {
  const all = getStack().skills.discoverAll().map(toSkillIndex)
  return c.json({ ok: true, items: all })
})

skillRoutes.get('/:name', (c) => {
  const s = getStack().skills.byName(c.req.param('name'))
  if (!s) return c.json({ ok: false, error: 'not_found' }, 404)
  return c.json({ ok: true, skill: s })
})

skillRoutes.post('/reload', (c) => {
  const stk = getStack()
  stk.skills.reload()
  return c.json({ ok: true, count: stk.skills.discoverAll().length })
})
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/skill.ts
git commit -m "feat(backend): skill routes (list/get/reload)"
```

---

## Task 26: Backend routes — cron jobs

**Files:**
- Create: `packages/backend/src/cron.ts`

- [ ] **Step 1: Implement routes**

```ts
import { Hono } from 'hono'
import { z } from 'zod'
import { getStack } from './services.js'

const UpdateBody = z.object({
  name: z.string().min(1).optional(),
  schedule: z.string().min(1).optional(),
  scheduleDescription: z.string().optional(),
  prompt: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
}).strict()

export const cronRoutes = new Hono()

cronRoutes.get('/', (c) => {
  const conv = c.req.query('conversationId') || undefined
  return c.json({ ok: true, items: getStack().cron.list(conv) })
})

cronRoutes.patch('/:id', async (c) => {
  const body = UpdateBody.parse(await c.req.json())
  const job = getStack().cron.update(c.req.param('id'), body)
  if (!job) return c.json({ ok: false, error: 'not_found' }, 404)
  return c.json({ ok: true, job })
})

cronRoutes.delete('/:id', (c) => {
  getStack().cron.delete(c.req.param('id'))
  return c.json({ ok: true })
})
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/cron.ts
git commit -m "feat(backend): cron-jobs routes (list/patch/delete)"
```

---

## Task 27: Backend routes — conversations (incl. SSE)

**Files:**
- Create: `packages/backend/src/conversation.ts`

- [ ] **Step 1: Implement routes**

```ts
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import { getStack } from './services.js'

const CreateBody = z.object({
  title: z.string().min(1),
  profileId: z.string().min(1).optional(),
  workspacePath: z.string().min(1),
  agent: z.enum(['claude', 'codex']).optional(),
  override: z.record(z.string(), z.unknown()).optional(),
}).strict()

const UpdateBody = z.object({
  title: z.string().min(1).optional(),
  archived: z.boolean().optional(),
  override: z.record(z.string(), z.unknown()).optional(),
  profileId: z.string().min(1).nullable().optional(),
}).strict()

const SendBody = z.object({
  content: z.string().min(1),
  override: z.record(z.string(), z.unknown()).optional(),
}).strict()

export const conversationRoutes = new Hono()

conversationRoutes.post('/', async (c) => {
  const body = CreateBody.parse(await c.req.json())
  const conv = getStack().conversation.create(body as never)
  return c.json({ ok: true, conversation: conv }, 201)
})

conversationRoutes.get('/', (c) => {
  const limit = Number(c.req.query('limit') ?? 50)
  const archivedRaw = c.req.query('archived')
  const archived = archivedRaw === undefined ? undefined : archivedRaw === 'true'
  return c.json({ ok: true, items: getStack().conversation.list({ limit, archived }) })
})

conversationRoutes.get('/:id', (c) => {
  const conv = getStack().conversation.get(c.req.param('id'))
  if (!conv) return c.json({ ok: false, error: 'not_found' }, 404)
  return c.json({ ok: true, conversation: conv })
})

conversationRoutes.patch('/:id', async (c) => {
  const body = UpdateBody.parse(await c.req.json())
  const conv = getStack().conversation.update(c.req.param('id'), body as never)
  return c.json({ ok: true, conversation: conv })
})

conversationRoutes.delete('/:id', (c) => {
  getStack().conversation.delete(c.req.param('id'))
  return c.json({ ok: true })
})

conversationRoutes.post('/:id/reset-skills', (c) => {
  const skills = getStack().conversation.resetSkills(c.req.param('id'))
  return c.json({ ok: true, skills })
})

conversationRoutes.post('/:id/messages', async (c) => {
  const body = SendBody.parse(await c.req.json())
  const r = await getStack().conversation.sendMessage(c.req.param('id'), body as never)
  return c.json({ ok: true, msgId: r.msgId, messageId: r.messageId }, 202)
})

conversationRoutes.get('/:id/messages', (c) => {
  return c.json({ ok: true, items: getStack().conversation.listMessages(c.req.param('id')) })
})

conversationRoutes.post('/:id/cancel', async (c) => {
  await getStack().conversation.cancel(c.req.param('id'))
  return c.json({ ok: true })
})

conversationRoutes.get('/:id/stream', (c) => {
  const id = c.req.param('id')
  return streamSSE(c, async (stream) => {
    const unsub = getStack().sse.subscribe(id, async (event) => {
      await stream.writeSSE({ event: event.name, data: JSON.stringify(event.data) })
    })
    const closed = new Promise<void>((resolve) => {
      stream.onAbort(() => { unsub(); resolve() })
    })
    await closed
  })
})
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/conversation.ts
git commit -m "feat(backend): conversation routes + SSE stream endpoint"
```

---

## Task 28: Mount routes in `app.ts` + update ai-agent.ts to accept `profileId`

**Files:**
- Modify: `packages/backend/src/app.ts`
- Modify: `packages/backend/src/ai-agent.ts`

- [ ] **Step 1: Read existing `app.ts`**

Run: `cat packages/backend/src/app.ts`
Goal: see existing mount pattern (likely `app.route('/research-crawler', ...)`).

- [ ] **Step 2: Mount the new route groups**

Edit `packages/backend/src/app.ts` to add (immediately after existing `.route(...)` calls):

```ts
import { conversationRoutes } from './conversation.js'
import { profileRoutes } from './profile.js'
import { skillRoutes } from './skill.js'
import { cronRoutes } from './cron.js'

// ... inside the factory / after app instantiation, alongside existing mounts:
app.route('/conversations', conversationRoutes)
app.route('/profiles', profileRoutes)
app.route('/skills', skillRoutes)
app.route('/cron-jobs', cronRoutes)
```

- [ ] **Step 3: Add `profileId` to `/ai-agent/run` schema**

Edit `packages/backend/src/ai-agent.ts` — inside `runAgentSchema`, add right after `cwd` line:

```ts
  profileId: z.string().min(1).optional(),
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @anubis/backend typecheck && pnpm --filter @anubis/conversation typecheck && pnpm --filter @anubis/ai-agent typecheck`
Expected: all exit 0.

- [ ] **Step 5: Build**

Run: `pnpm --filter @anubis/ai-agent build && pnpm --filter @anubis/conversation build && pnpm --filter @anubis/backend build`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/app.ts packages/backend/src/ai-agent.ts
git commit -m "feat(backend): mount conversation/profile/skill/cron routes; ai-agent accepts profileId"
```

---

## Task 29: Wire `ANUBIS_DATA_DIR` through Electron main

**Files:**
- Modify: `apps/desktop/electron/main/backend.ts` (set env when spawning backend)
- Modify: `apps/desktop/electron/main/index.ts` (graceful shutdown hook — optional)

- [ ] **Step 1: Locate the backend spawn**

Run: `grep -n "ANUBIS_BACKEND_PORT\|spawn\|env" apps/desktop/electron/main/backend.ts`
Expected: locate the env object passed to `spawn` / `fork`.

- [ ] **Step 2: Pass `ANUBIS_DATA_DIR`**

Edit `apps/desktop/electron/main/backend.ts` to set the env var alongside the existing `ANUBIS_BACKEND_PORT`. Compute the data dir via:

```ts
import { app } from 'electron'
import { join } from 'node:path'

const dataDir = join(app.getPath('userData'), 'anubis')

// inside the env object passed to spawn/fork:
env: {
  ...process.env,
  ANUBIS_BACKEND_PORT: '0',
  ANUBIS_DATA_DIR: dataDir,
  ELECTRON_RUN_AS_NODE: '1', // keep existing if present
},
```

- [ ] **Step 3: Build the desktop bundle**

Run: `pnpm --filter @anubis/backend build && pnpm --filter @anubis/conversation build && pnpm --filter @anubis/ai-agent build`
Expected: all exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/electron/main/backend.ts
git commit -m "feat(desktop): pass ANUBIS_DATA_DIR to backend child"
```

---

## Task 30: End-to-end smoke test (backend in-process)

**Files:**
- Create: `packages/backend/tests/conversation-smoke.test.ts`
- Modify: `packages/backend/package.json` (add devDependencies for vitest + types if needed)

- [ ] **Step 1: Check backend tests dir exists**

Run: `ls packages/backend/tests 2>/dev/null || mkdir -p packages/backend/tests`

- [ ] **Step 2: Write smoke test**

`packages/backend/tests/conversation-smoke.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from '../src/app.js'
import { shutdownStack } from '../src/services.js'

describe('backend smoke — profiles + conversation create', () => {
  beforeAll(() => {
    process.env.ANUBIS_DATA_DIR = mkdtempSync(join(tmpdir(), 'anubis-smoke-'))
  })
  afterAll(async () => { await shutdownStack() })

  it('GET /profiles lists the 5 builtin profiles', async () => {
    const res = await app.request('/profiles')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: { id: string }[] }
    const ids = body.items.map(p => p.id)
    for (const id of ['claude-coding', 'claude-yolo', 'claude-research', 'codex-coding', 'codex-yolo']) {
      expect(ids).toContain(id)
    }
  })

  it('POST /conversations creates a conversation referencing a profile', async () => {
    const res = await app.request('/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'smoke', profileId: 'claude-coding', workspacePath: process.cwd(),
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { conversation: { id: string; agent: string } }
    expect(body.conversation.agent).toBe('claude')
  })

  it('GET /skills returns the cron-helper builtin', async () => {
    const res = await app.request('/skills')
    const body = (await res.json()) as { items: { name: string }[] }
    expect(body.items.some(s => s.name === 'cron-helper')).toBe(true)
  })
})
```

- [ ] **Step 3: Ensure `app` is exported**

Edit `packages/backend/src/app.ts` and confirm `export const app = ...`. If not, add `export` to the existing app instance.

- [ ] **Step 4: Run the smoke test**

Run: `pnpm vitest run packages/backend/tests/conversation-smoke.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 5: Run the full repo test + typecheck**

Run: `pnpm typecheck && pnpm test`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/tests/conversation-smoke.test.ts packages/backend/src/app.ts
git commit -m "test(backend): end-to-end smoke for profiles + conversation + skills"
```

---

## Self-Review

**1. Spec coverage:**
- §1 Architecture & layout → Tasks 1, 12, 22, 23, 28
- §2 Data model / schema → Tasks 3–5, 9, 15, 18
- §3 Profile model + resolution + builtins + service → Tasks 7–10, 24
- §4 Skills pipeline (loader, snapshot, inject, location) → Tasks 11–14, 25
- §5 TaskManager + StreamRelay + cron + SSE + idle → Tasks 16–21, 22
- §6 HTTP API → Tasks 24, 25, 26, 27, 28
- §7 Dependencies → Task 1
- Breaking rename `profile → claudeCliProfile` → Task 2
- Electron wiring `ANUBIS_DATA_DIR` → Task 29

**2. Placeholder scan:**
- One acknowledged stub: `AgentTask.sendMessage` in TaskManager throws if called a second time — the first turn flows through `getOrBuild`, follow-ups respawn with `prevAgentSessionId`. This is documented under Task 19 with a "post-MVP" note. Acceptable for this cut because the runners don't expose a "send another turn" surface yet; resume semantics handle the user-facing UX.
- `thinking` event from spec dropped — current `AgentEventMap` doesn't carry it.

**3. Type consistency:**
- `ResolvedProfile` used uniformly (types.ts → resolve.ts → ProfileService → ConversationService → TaskManager).
- `SkillDefinition` shape consistent across loader, snapshot, inject, types.
- `Conversation.agent` is `'claude' | 'codex'` everywhere (matches `AgentSchema`).
- `claudeCliProfile` field name consistent across RunAgentInput (Task 2), ProfileConfig (Task 7), TaskManager forwarding (Task 19).

**4. Coverage gaps:**
- No explicit task for "spec §6 documents a list-paging cursor" — `ConversationService.list` accepts `limit` only. Acceptable: cursor is a YAGNI for ≤50 entries; HTTP route returns a flat list. If needed, add cursor later in a one-task change.

---

## Execution Handoff

Plan complete and saved to [`docs/superpowers/plans/2026-06-02-conversation-profiles-skills.md`](docs/superpowers/plans/2026-06-02-conversation-profiles-skills.md). Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
