# Scoped Content Memory — Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a new `@anubis/content-memory` package with a first-class Brand/Workspace entity, scope the existing competitors to it, and prove cross-workspace isolation on a scoped knowledge store — the guarantee everything else in the spec depends on.

**Architecture:** A new logical package (`@anubis/content-memory`) owns its types, repos, and SQL migrations for new tables (`content_workspaces`, `knowledge_documents`) and exports them as `CONTENT_MEMORY_MIGRATIONS`. `@anubis/conversation` depends on it **one-way**: it registers those migrations into its existing runner, instantiates the new repos against the shared `anubis.db` handle, exposes them on `ConversationStack`, and owns the single `ALTER competitors ADD workspace_id` migration (which runs *after* `content_workspaces` exists). Embeddings, chunks, similarity items, context-pack, experience, and validators are **out of scope for this phase** — they get their own plans.

**Tech Stack:** TypeScript (ESM, NodeNext), better-sqlite3 (raw SQL, repo pattern), Vitest, pnpm workspaces.

**Reference docs:** `docs/superpowers/specs/2026-06-05-scoped-content-memory-design.md` (the reconciled design; this plan implements its §8 Phase 1), and the original `anubis-scoped-content-memory-spec.md` (§9 data model, §11 retrieval rules, §22 tests).

---

## Scope of this phase

In scope (maps to design §8 Phase 1):

- New `@anubis/content-memory` package skeleton, wired into the monorepo build order.
- Core types + constants (`Scope`, `Platform`, `PLATFORMS`, `DEFAULT_WORKSPACE_ID`).
- `content_workspaces` table + `ContentWorkspacesRepo` + `ContentWorkspacesService`.
- `knowledge_documents` table + `KnowledgeDocumentsRepo` with **scope-before-rank** lexical search.
- `competitors.workspace_id` column + default-brand backfill migration (owned by conversation).
- Cross-workspace isolation, global-knowledge, and platform-filter tests (original spec §22.1–§22.3, adapted to documents).
- Wiring into `ConversationStack` and the monorepo build/test scripts.

Explicitly **out of scope** (later phase plans): embeddings/vectors, `knowledge_chunks`, `content_similarity_items`, ingestion from `captured_posts`, `ContentContextPack`, `experience_memories`, validators, HTTP routes, workflow nodes.

---

## File structure

New package `packages/content-memory/`:

```
packages/content-memory/
├── package.json                         # @anubis/content-memory
├── tsconfig.json                        # extends ../../tsconfig.base.json
├── scripts/copy-sql.mjs                 # copies src/db/migrations/*.sql → dist
├── src/
│   ├── index.ts                         # public exports
│   ├── types.ts                         # Scope, Platform, PLATFORMS, DEFAULT_WORKSPACE_ID
│   ├── db/
│   │   ├── types.ts                     # Db, Migration (local, structural)
│   │   ├── migrations/
│   │   │   ├── index.ts                 # CONTENT_MEMORY_MIGRATIONS
│   │   │   ├── 008_content_workspaces.sql
│   │   │   └── 009_knowledge_documents.sql
│   │   └── repositories/
│   │       ├── content-workspaces-repo.ts
│   │       └── knowledge-documents-repo.ts
│   └── workspaces/
│       └── content-workspaces-service.ts
└── tests/
    ├── helpers/db.ts                     # in-memory DB + apply migrations
    ├── content-workspaces-repo.test.ts
    ├── content-workspaces-service.test.ts
    └── knowledge-documents-repo.test.ts
```

Modified in `packages/conversation/`:

```
packages/conversation/
├── package.json                                       # + @anubis/content-memory dep
├── src/
│   ├── index.ts                                       # register migrations, expose repos
│   ├── db/migrations/index.ts                         # splice in CONTENT_MEMORY_MIGRATIONS + 010
│   ├── db/migrations/010_competitors_workspace.sql    # NEW (ALTER + backfill)
│   └── db/repositories/competitors-repo.ts            # + workspaceId
└── tests/
    └── db/competitors-workspace.test.ts               # NEW (backfill + default)
```

Modified at repo root:

```
package.json   # add @anubis/content-memory to build + pretest, before @anubis/conversation
```

---

## Task 1: Scaffold the `@anubis/content-memory` package

**Files:**
- Create: `packages/content-memory/package.json`
- Create: `packages/content-memory/tsconfig.json`
- Create: `packages/content-memory/scripts/copy-sql.mjs`
- Create: `packages/content-memory/src/index.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@anubis/content-memory",
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
    "build": "tsc -p tsconfig.json && node ./scripts/copy-sql.mjs",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@anubis/shared": "workspace:*",
    "uuid": "^11.0.3"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^22.19.1",
    "@types/uuid": "^10.0.0",
    "better-sqlite3": "^12.10.0",
    "typescript": "^5.9.3"
  },
  "engines": {
    "node": ">=22"
  }
}
```

Note: `better-sqlite3` is a **devDependency** — production passes in a live handle created by `@anubis/conversation`; this package only needs the type at build and the constructor in its own tests.

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "dist",
    "types": ["node"],
    "declaration": true,
    "sourceMap": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create `scripts/copy-sql.mjs`**

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

- [ ] **Step 4: Create a placeholder `src/index.ts`**

```ts
export {}
```

- [ ] **Step 5: Install workspace deps**

Run: `pnpm install`
Expected: completes; `@anubis/content-memory` is linked into the workspace (no error about missing package).

- [ ] **Step 6: Commit**

```bash
git add packages/content-memory/package.json packages/content-memory/tsconfig.json packages/content-memory/scripts/copy-sql.mjs packages/content-memory/src/index.ts pnpm-lock.yaml
git commit -m "chore(content-memory): scaffold @anubis/content-memory package"
```

---

## Task 2: Core types and constants

**Files:**
- Create: `packages/content-memory/src/types.ts`
- Create: `packages/content-memory/src/db/types.ts`
- Test: `packages/content-memory/tests/content-workspaces-repo.test.ts` (constants asserted indirectly later; a focused constants check goes here)

- [ ] **Step 1: Write the failing test**

Create `packages/content-memory/tests/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_WORKSPACE_ID, PLATFORMS } from '../src/types.js'

describe('content-memory constants', () => {
  it('exposes the well-known default workspace id', () => {
    expect(DEFAULT_WORKSPACE_ID).toBe('default-workspace')
  })

  it('lists the supported platforms including general', () => {
    expect(PLATFORMS).toContain('instagram')
    expect(PLATFORMS).toContain('general')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/content-memory/tests/types.test.ts`
Expected: FAIL — cannot resolve `../src/types.js`.

- [ ] **Step 3: Create `src/db/types.ts`**

```ts
import type { Database as DbHandle } from 'better-sqlite3'

/** The shared better-sqlite3 handle. Production passes conversation's db here. */
export type Db = DbHandle

/** Structurally identical to conversation's Migration so it can be spliced in. */
export interface Migration {
  version: number
  sql: string
}
```

- [ ] **Step 4: Create `src/types.ts`**

```ts
/** Knowledge scope. MVP supports global + workspace only. */
export type Scope = 'global' | 'workspace'

export type Platform =
  | 'instagram'
  | 'tiktok'
  | 'youtube'
  | 'facebook'
  | 'linkedin'
  | 'x'
  | 'threads'
  | 'general'

export const PLATFORMS: readonly Platform[] = [
  'instagram',
  'tiktok',
  'youtube',
  'facebook',
  'linkedin',
  'x',
  'threads',
  'general',
]

/** Well-known id of the auto-created brand all legacy competitors are assigned to. */
export const DEFAULT_WORKSPACE_ID = 'default-workspace'

export type DocumentStatus = 'active' | 'archived' | 'deprecated'

export type SourceType =
  | 'brand_guideline'
  | 'competitor_post'
  | 'approved_post'
  | 'rejected_post'
  | 'campaign_brief'
  | 'manual_note'
  | 'platform_rule'
  | 'global_framework'
  | 'sop'
  | 'ai_feedback'
  | 'transcript'
  | 'ocr'
  | 'file'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/content-memory/tests/types.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/content-memory/src/types.ts packages/content-memory/src/db/types.ts packages/content-memory/tests/types.test.ts
git commit -m "feat(content-memory): core types and constants"
```

---

## Task 3: `content_workspaces` migration + repo

**Files:**
- Create: `packages/content-memory/src/db/migrations/008_content_workspaces.sql`
- Create: `packages/content-memory/src/db/repositories/content-workspaces-repo.ts`
- Create: `packages/content-memory/tests/helpers/db.ts`
- Test: `packages/content-memory/tests/content-workspaces-repo.test.ts`

- [ ] **Step 1: Create the test helper**

Create `packages/content-memory/tests/helpers/db.ts`:

```ts
import Database from 'better-sqlite3'
import type { Db, Migration } from '../../src/db/types.js'

/** Open an in-memory DB and apply the given migrations in version order. */
export function freshDb(migrations: Migration[]): Db {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    db.exec(m.sql)
  }
  return db
}
```

- [ ] **Step 2: Write the failing test**

Create `packages/content-memory/tests/content-workspaces-repo.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { freshDb } from './helpers/db.js'
import { ContentWorkspacesRepo } from '../src/db/repositories/content-workspaces-repo.js'
import { DEFAULT_WORKSPACE_ID } from '../src/types.js'

const here = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(
  join(here, '../src/db/migrations/008_content_workspaces.sql'),
  'utf8',
)
const migrations = [{ version: 8, sql }]

describe('ContentWorkspacesRepo', () => {
  it('seeds a default workspace via the migration', () => {
    const repo = new ContentWorkspacesRepo(freshDb(migrations))
    const def = repo.findById(DEFAULT_WORKSPACE_ID)
    expect(def?.name).toBe('Default Workspace')
  })

  it('inserts and reads a brand with array fields round-tripped', () => {
    const repo = new ContentWorkspacesRepo(freshDb(migrations))
    repo.insert({
      id: 'ws-a',
      name: 'Skincare A',
      brandSummary: 'Gentle skincare',
      toneOfVoice: ['warm', 'educational'],
      audience: ['women 25-40'],
      offers: ['serum'],
      constraints: ['no fear-based hooks'],
      status: 'active',
      createdAt: 100,
      updatedAt: 100,
    })
    const got = repo.findById('ws-a')
    expect(got?.toneOfVoice).toEqual(['warm', 'educational'])
    expect(got?.constraints).toEqual(['no fear-based hooks'])
  })

  it('lists active workspaces', () => {
    const repo = new ContentWorkspacesRepo(freshDb(migrations))
    repo.insert({
      id: 'ws-a', name: 'A', brandSummary: null,
      toneOfVoice: [], audience: [], offers: [], constraints: [],
      status: 'active', createdAt: 100, updatedAt: 100,
    })
    const ids = repo.list().map((w) => w.id)
    expect(ids).toContain('ws-a')
    expect(ids).toContain(DEFAULT_WORKSPACE_ID)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run packages/content-memory/tests/content-workspaces-repo.test.ts`
Expected: FAIL — cannot resolve the migration SQL file / repo module.

- [ ] **Step 4: Create the migration SQL**

Create `packages/content-memory/src/db/migrations/008_content_workspaces.sql`:

```sql
-- The first-class Brand/Workspace entity. Source for the context pack's brandContext.
CREATE TABLE content_workspaces (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  brand_summary TEXT,
  tone_of_voice TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
  audience      TEXT NOT NULL DEFAULT '[]',    -- JSON array of strings
  offers        TEXT NOT NULL DEFAULT '[]',    -- JSON array of strings
  constraints   TEXT NOT NULL DEFAULT '[]',    -- JSON array of strings (hard "must avoid")
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- Auto-create the default brand that legacy competitors are backfilled to (migration 010).
INSERT OR IGNORE INTO content_workspaces
  (id, name, brand_summary, tone_of_voice, audience, offers, constraints, status, created_at, updated_at)
VALUES
  ('default-workspace', 'Default Workspace', NULL, '[]', '[]', '[]', '[]', 'active', 0, 0);
```

- [ ] **Step 5: Create the repo**

Create `packages/content-memory/src/db/repositories/content-workspaces-repo.ts`:

```ts
import type { Db } from '../types.js'
import type { ContentWorkspaceStatus } from '../../types.js'

export interface ContentWorkspace {
  id: string
  name: string
  brandSummary: string | null
  toneOfVoice: string[]
  audience: string[]
  offers: string[]
  constraints: string[]
  status: ContentWorkspaceStatus
  createdAt: number
  updatedAt: number
}

interface Row {
  id: string
  name: string
  brand_summary: string | null
  tone_of_voice: string
  audience: string
  offers: string
  constraints: string
  status: string
  created_at: number
  updated_at: number
}

function parseArr(s: string): string[] {
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? (v as string[]) : []
  } catch {
    return []
  }
}

function toWorkspace(r: Row): ContentWorkspace {
  return {
    id: r.id,
    name: r.name,
    brandSummary: r.brand_summary,
    toneOfVoice: parseArr(r.tone_of_voice),
    audience: parseArr(r.audience),
    offers: parseArr(r.offers),
    constraints: parseArr(r.constraints),
    status: r.status as ContentWorkspaceStatus,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export class ContentWorkspacesRepo {
  constructor(private db: Db) {}

  insert(w: ContentWorkspace): void {
    this.db.prepare(`
      INSERT INTO content_workspaces (
        id, name, brand_summary, tone_of_voice, audience, offers, constraints,
        status, created_at, updated_at
      ) VALUES (
        @id, @name, @brandSummary, @toneOfVoice, @audience, @offers, @constraints,
        @status, @createdAt, @updatedAt
      )
    `).run({
      id: w.id,
      name: w.name,
      brandSummary: w.brandSummary ?? null,
      toneOfVoice: JSON.stringify(w.toneOfVoice),
      audience: JSON.stringify(w.audience),
      offers: JSON.stringify(w.offers),
      constraints: JSON.stringify(w.constraints),
      status: w.status,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
    })
  }

  findById(id: string): ContentWorkspace | null {
    const r = this.db
      .prepare('SELECT * FROM content_workspaces WHERE id = ?')
      .get(id) as Row | undefined
    return r ? toWorkspace(r) : null
  }

  list(): ContentWorkspace[] {
    const rows = this.db
      .prepare("SELECT * FROM content_workspaces WHERE status = 'active' ORDER BY created_at DESC, name ASC")
      .all() as Row[]
    return rows.map(toWorkspace)
  }
}
```

- [ ] **Step 6: Add the `ContentWorkspaceStatus` type to `src/types.ts`**

Add to `packages/content-memory/src/types.ts`:

```ts
export type ContentWorkspaceStatus = 'active' | 'archived'
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm vitest run packages/content-memory/tests/content-workspaces-repo.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/content-memory/src/db/migrations/008_content_workspaces.sql packages/content-memory/src/db/repositories/content-workspaces-repo.ts packages/content-memory/src/types.ts packages/content-memory/tests/helpers/db.ts packages/content-memory/tests/content-workspaces-repo.test.ts
git commit -m "feat(content-memory): content_workspaces table and repo"
```

---

## Task 4: `knowledge_documents` migration + scoped search repo

**Files:**
- Create: `packages/content-memory/src/db/migrations/009_knowledge_documents.sql`
- Create: `packages/content-memory/src/db/repositories/knowledge-documents-repo.ts`
- Test: `packages/content-memory/tests/knowledge-documents-repo.test.ts`

This task implements the **core MVP guarantee**: scope + platform filtering happens in the SQL `WHERE` (before any ranking). Tests are adapted from original spec §22.1–§22.3.

- [ ] **Step 1: Write the failing test**

Create `packages/content-memory/tests/knowledge-documents-repo.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { freshDb } from './helpers/db.js'
import { ContentWorkspacesRepo } from '../src/db/repositories/content-workspaces-repo.js'
import {
  KnowledgeDocumentsRepo,
  type NewKnowledgeDocument,
} from '../src/db/repositories/knowledge-documents-repo.js'

const here = dirname(fileURLToPath(import.meta.url))
function sqlFor(file: string): string {
  return readFileSync(join(here, '../src/db/migrations', file), 'utf8')
}
const migrations = [
  { version: 8, sql: sqlFor('008_content_workspaces.sql') },
  { version: 9, sql: sqlFor('009_knowledge_documents.sql') },
]

function setup() {
  const db = freshDb(migrations)
  const workspaces = new ContentWorkspacesRepo(db)
  for (const id of ['workspace-a', 'workspace-b']) {
    workspaces.insert({
      id, name: id, brandSummary: null,
      toneOfVoice: [], audience: [], offers: [], constraints: [],
      status: 'active', createdAt: 100, updatedAt: 100,
    })
  }
  return new KnowledgeDocumentsRepo(db)
}

function doc(over: Partial<NewKnowledgeDocument>): NewKnowledgeDocument {
  return {
    id: over.id ?? `d-${Math.random().toString(36).slice(2)}`,
    scope: over.scope ?? 'workspace',
    workspaceId: over.workspaceId ?? 'workspace-a',
    platform: over.platform ?? null,
    sourceType: over.sourceType ?? 'manual_note',
    title: over.title ?? 'Untitled',
    extractedText: over.extractedText ?? 'body',
    summary: over.summary ?? null,
    tags: over.tags ?? [],
    topics: over.topics ?? [],
    entities: over.entities ?? [],
    status: over.status ?? 'active',
    contentHash: over.contentHash ?? 'hash',
    createdAt: over.createdAt ?? 100,
    updatedAt: over.updatedAt ?? 100,
  }
}

describe('KnowledgeDocumentsRepo.search — scope isolation', () => {
  it('does not retrieve documents from another workspace (spec §22.1)', () => {
    const repo = setup()
    repo.insert(doc({ workspaceId: 'workspace-a', extractedText: 'Skincare brand A' }))
    repo.insert(doc({ workspaceId: 'workspace-b', extractedText: 'Skincare brand B' }))

    const results = repo.search({
      workspaceId: 'workspace-a',
      platform: 'instagram',
      query: 'skincare',
    })

    expect(results.length).toBeGreaterThan(0)
    expect(
      results.every((r) => r.scope === 'global' || r.workspaceId === 'workspace-a'),
    ).toBe(true)
  })

  it('allows global knowledge across workspaces (spec §22.2)', () => {
    const repo = setup()
    repo.insert(doc({
      scope: 'global', workspaceId: null,
      title: 'Instagram hook framework', extractedText: 'hook framework',
      sourceType: 'global_framework',
    }))

    const results = repo.search({
      workspaceId: 'workspace-a',
      platform: 'instagram',
      query: 'hook framework',
    })

    expect(results.some((r) => r.scope === 'global')).toBe(true)
  })

  it('does not retrieve a TikTok-only doc for an Instagram task (spec §22.3)', () => {
    const repo = setup()
    repo.insert(doc({
      scope: 'global', workspaceId: null, platform: 'tiktok',
      title: 'TikTok trend hook', extractedText: 'trend hook',
      sourceType: 'global_framework',
    }))

    const results = repo.search({
      workspaceId: 'workspace-a',
      platform: 'instagram',
      query: 'trend hook',
    })

    expect(results.every((r) => r.platform !== 'tiktok')).toBe(true)
  })

  it('excludes non-active documents by default', () => {
    const repo = setup()
    repo.insert(doc({ workspaceId: 'workspace-a', status: 'deprecated', extractedText: 'old advice' }))
    const results = repo.search({
      workspaceId: 'workspace-a', platform: 'instagram', query: 'old advice',
    })
    expect(results).toHaveLength(0)
  })

  it('can exclude global results when includeGlobal is false', () => {
    const repo = setup()
    repo.insert(doc({ scope: 'global', workspaceId: null, extractedText: 'global note' }))
    const results = repo.search({
      workspaceId: 'workspace-a', platform: 'instagram', query: 'global note',
      includeGlobal: false,
    })
    expect(results).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/content-memory/tests/knowledge-documents-repo.test.ts`
Expected: FAIL — cannot resolve `009_knowledge_documents.sql` / repo module.

- [ ] **Step 3: Create the migration SQL**

Create `packages/content-memory/src/db/migrations/009_knowledge_documents.sql`:

```sql
-- Scoped knowledge store. scope/workspace_id/platform are filtered BEFORE ranking.
CREATE TABLE knowledge_documents (
  id             TEXT PRIMARY KEY,
  scope          TEXT NOT NULL CHECK (scope IN ('global', 'workspace')),
  workspace_id   TEXT REFERENCES content_workspaces(id),
  platform       TEXT,                       -- NULL = applies to all platforms
  source_type    TEXT NOT NULL,
  title          TEXT NOT NULL,
  extracted_text TEXT NOT NULL,
  summary        TEXT,
  tags           TEXT NOT NULL DEFAULT '[]', -- JSON array
  topics         TEXT NOT NULL DEFAULT '[]', -- JSON array
  entities       TEXT NOT NULL DEFAULT '[]', -- JSON array
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'archived', 'deprecated')),
  content_hash   TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  -- Enforce spec §9.1: global ⇒ no workspace; workspace ⇒ has workspace.
  CHECK (
    (scope = 'global' AND workspace_id IS NULL)
    OR (scope = 'workspace' AND workspace_id IS NOT NULL)
  )
);

CREATE INDEX idx_knowledge_documents_scope
  ON knowledge_documents(scope, workspace_id);
CREATE INDEX idx_knowledge_documents_platform
  ON knowledge_documents(platform);
```

- [ ] **Step 4: Create the repo**

Create `packages/content-memory/src/db/repositories/knowledge-documents-repo.ts`:

```ts
import type { Db } from '../types.js'
import type { DocumentStatus, Platform, Scope, SourceType } from '../../types.js'

export interface KnowledgeDocument {
  id: string
  scope: Scope
  workspaceId: string | null
  platform: Platform | null
  sourceType: SourceType
  title: string
  extractedText: string
  summary: string | null
  tags: string[]
  topics: string[]
  entities: string[]
  status: DocumentStatus
  contentHash: string
  createdAt: number
  updatedAt: number
}

export type NewKnowledgeDocument = KnowledgeDocument

export interface SearchKnowledgeInput {
  workspaceId: string
  platform: Platform
  query: string
  includeGlobal?: boolean
  limit?: number
}

/** A document plus a lexical relevance score (semantic ranking arrives in a later phase). */
export type ScoredDocument = KnowledgeDocument & { score: number }

interface Row {
  id: string
  scope: string
  workspace_id: string | null
  platform: string | null
  source_type: string
  title: string
  extracted_text: string
  summary: string | null
  tags: string
  topics: string
  entities: string
  status: string
  content_hash: string
  created_at: number
  updated_at: number
}

function parseArr(s: string): string[] {
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? (v as string[]) : []
  } catch {
    return []
  }
}

function toDoc(r: Row): KnowledgeDocument {
  return {
    id: r.id,
    scope: r.scope as Scope,
    workspaceId: r.workspace_id,
    platform: (r.platform as Platform | null) ?? null,
    sourceType: r.source_type as SourceType,
    title: r.title,
    extractedText: r.extracted_text,
    summary: r.summary,
    tags: parseArr(r.tags),
    topics: parseArr(r.topics),
    entities: parseArr(r.entities),
    status: r.status as DocumentStatus,
    contentHash: r.content_hash,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

/** Count case-insensitive occurrences of query terms across title + body. */
function lexicalScore(doc: KnowledgeDocument, query: string): number {
  const hay = `${doc.title} ${doc.extractedText}`.toLowerCase()
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  let score = 0
  for (const t of terms) {
    let from = 0
    for (;;) {
      const i = hay.indexOf(t, from)
      if (i === -1) break
      score += 1
      from = i + t.length
    }
  }
  return score
}

export class KnowledgeDocumentsRepo {
  constructor(private db: Db) {}

  insert(d: NewKnowledgeDocument): void {
    this.db.prepare(`
      INSERT INTO knowledge_documents (
        id, scope, workspace_id, platform, source_type, title, extracted_text,
        summary, tags, topics, entities, status, content_hash, created_at, updated_at
      ) VALUES (
        @id, @scope, @workspaceId, @platform, @sourceType, @title, @extractedText,
        @summary, @tags, @topics, @entities, @status, @contentHash, @createdAt, @updatedAt
      )
    `).run({
      id: d.id,
      scope: d.scope,
      workspaceId: d.workspaceId ?? null,
      platform: d.platform ?? null,
      sourceType: d.sourceType,
      title: d.title,
      extractedText: d.extractedText,
      summary: d.summary ?? null,
      tags: JSON.stringify(d.tags),
      topics: JSON.stringify(d.topics),
      entities: JSON.stringify(d.entities),
      status: d.status,
      contentHash: d.contentHash,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    })
  }

  /**
   * Scope + platform filtering happens in SQL, BEFORE ranking (spec §11).
   * Lexical scoring is applied in JS afterward; semantic ranking is a later phase.
   */
  search(input: SearchKnowledgeInput): ScoredDocument[] {
    const includeGlobal = input.includeGlobal ?? true
    const like = `%${input.query}%`
    const rows = this.db.prepare(`
      SELECT * FROM knowledge_documents
      WHERE status = 'active'
        AND (
          workspace_id = @workspaceId
          OR (@includeGlobal = 1 AND scope = 'global')
        )
        AND (platform IS NULL OR platform = @platform OR platform = 'general')
        AND (extracted_text LIKE @like OR title LIKE @like)
    `).all({
      workspaceId: input.workspaceId,
      includeGlobal: includeGlobal ? 1 : 0,
      platform: input.platform,
      like,
    }) as Row[]

    const scored = rows
      .map(toDoc)
      .map((d) => ({ ...d, score: lexicalScore(d, input.query) }))
      .sort((a, b) => b.score - a.score || b.createdAt - a.createdAt)

    return typeof input.limit === 'number' ? scored.slice(0, input.limit) : scored
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/content-memory/tests/knowledge-documents-repo.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/content-memory/src/db/migrations/009_knowledge_documents.sql packages/content-memory/src/db/repositories/knowledge-documents-repo.ts packages/content-memory/tests/knowledge-documents-repo.test.ts
git commit -m "feat(content-memory): scoped knowledge_documents store with isolation tests"
```

---

## Task 5: `ContentWorkspacesService` (id generation + create)

**Files:**
- Create: `packages/content-memory/src/workspaces/content-workspaces-service.ts`
- Test: `packages/content-memory/tests/content-workspaces-service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/content-memory/tests/content-workspaces-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { freshDb } from './helpers/db.js'
import { ContentWorkspacesRepo } from '../src/db/repositories/content-workspaces-repo.js'
import { ContentWorkspacesService } from '../src/workspaces/content-workspaces-service.js'

const here = dirname(fileURLToPath(import.meta.url))
const migrations = [{
  version: 8,
  sql: readFileSync(join(here, '../src/db/migrations/008_content_workspaces.sql'), 'utf8'),
}]

function service() {
  return new ContentWorkspacesService(new ContentWorkspacesRepo(freshDb(migrations)))
}

describe('ContentWorkspacesService', () => {
  it('creates a workspace with a generated id and defaults', () => {
    const svc = service()
    const ws = svc.create({ name: 'Skincare A' })
    expect(ws.id).toMatch(/[0-9a-f-]{36}/)
    expect(ws.name).toBe('Skincare A')
    expect(ws.toneOfVoice).toEqual([])
    expect(ws.status).toBe('active')
    expect(svc.get(ws.id)?.name).toBe('Skincare A')
  })

  it('persists provided brand fields', () => {
    const svc = service()
    const ws = svc.create({
      name: 'B', brandSummary: 'gentle', toneOfVoice: ['warm'],
      constraints: ['no fear hooks'],
    })
    expect(svc.get(ws.id)?.constraints).toEqual(['no fear hooks'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/content-memory/tests/content-workspaces-service.test.ts`
Expected: FAIL — cannot resolve the service module.

- [ ] **Step 3: Create the service**

Create `packages/content-memory/src/workspaces/content-workspaces-service.ts`:

```ts
import { randomUUID } from 'node:crypto'
import type {
  ContentWorkspace,
  ContentWorkspacesRepo,
} from '../db/repositories/content-workspaces-repo.js'

export interface CreateContentWorkspaceInput {
  name: string
  brandSummary?: string | null
  toneOfVoice?: string[]
  audience?: string[]
  offers?: string[]
  constraints?: string[]
}

export class ContentWorkspacesService {
  constructor(private repo: ContentWorkspacesRepo) {}

  create(input: CreateContentWorkspaceInput, now: number = Date.now()): ContentWorkspace {
    const ws: ContentWorkspace = {
      id: randomUUID(),
      name: input.name,
      brandSummary: input.brandSummary ?? null,
      toneOfVoice: input.toneOfVoice ?? [],
      audience: input.audience ?? [],
      offers: input.offers ?? [],
      constraints: input.constraints ?? [],
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }
    this.repo.insert(ws)
    return ws
  }

  get(id: string): ContentWorkspace | null {
    return this.repo.findById(id)
  }

  list(): ContentWorkspace[] {
    return this.repo.list()
  }
}
```

Note: `randomUUID` from `node:crypto` avoids adding `uuid` as a runtime call here; the `uuid` dep stays available for parity with other packages but is not required by this file.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/content-memory/tests/content-workspaces-service.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/content-memory/src/workspaces/content-workspaces-service.ts packages/content-memory/tests/content-workspaces-service.test.ts
git commit -m "feat(content-memory): ContentWorkspacesService with id generation"
```

---

## Task 6: Public API + migrations index

**Files:**
- Create: `packages/content-memory/src/db/migrations/index.ts`
- Modify: `packages/content-memory/src/index.ts`
- Test: `packages/content-memory/tests/migrations-index.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/content-memory/tests/migrations-index.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { CONTENT_MEMORY_MIGRATIONS } from '../src/db/migrations/index.js'

describe('CONTENT_MEMORY_MIGRATIONS', () => {
  it('exports versions 8 and 9 with non-empty SQL', () => {
    const versions = CONTENT_MEMORY_MIGRATIONS.map((m) => m.version)
    expect(versions).toEqual([8, 9])
    for (const m of CONTENT_MEMORY_MIGRATIONS) {
      expect(m.sql.length).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/content-memory/tests/migrations-index.test.ts`
Expected: FAIL — cannot resolve `../src/db/migrations/index.js`.

- [ ] **Step 3: Create the migrations index**

Create `packages/content-memory/src/db/migrations/index.ts`:

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { Migration } from '../types.js'

const here = dirname(fileURLToPath(import.meta.url))

function load(version: number, file: string): Migration {
  return { version, sql: readFileSync(join(here, file), 'utf8') }
}

/** Migrations owned by content-memory. Conversation splices these into its runner. */
export const CONTENT_MEMORY_MIGRATIONS: Migration[] = [
  load(8, '008_content_workspaces.sql'),
  load(9, '009_knowledge_documents.sql'),
]
```

- [ ] **Step 4: Replace `src/index.ts` with real exports**

Replace the contents of `packages/content-memory/src/index.ts`:

```ts
export type {
  Scope,
  Platform,
  DocumentStatus,
  SourceType,
  ContentWorkspaceStatus,
} from './types.js'
export { PLATFORMS, DEFAULT_WORKSPACE_ID } from './types.js'

export type { Db, Migration } from './db/types.js'
export { CONTENT_MEMORY_MIGRATIONS } from './db/migrations/index.js'

export type { ContentWorkspace } from './db/repositories/content-workspaces-repo.js'
export { ContentWorkspacesRepo } from './db/repositories/content-workspaces-repo.js'

export type {
  KnowledgeDocument,
  NewKnowledgeDocument,
  SearchKnowledgeInput,
  ScoredDocument,
} from './db/repositories/knowledge-documents-repo.js'
export { KnowledgeDocumentsRepo } from './db/repositories/knowledge-documents-repo.js'

export type { CreateContentWorkspaceInput } from './workspaces/content-workspaces-service.js'
export { ContentWorkspacesService } from './workspaces/content-workspaces-service.js'
```

- [ ] **Step 5: Run test + typecheck + build**

Run: `pnpm vitest run packages/content-memory/tests/migrations-index.test.ts`
Expected: PASS (1 test).

Run: `pnpm --filter @anubis/content-memory typecheck`
Expected: no errors.

Run: `pnpm --filter @anubis/content-memory build`
Expected: completes; prints `copied SQL migrations → dist/db/migrations`.

- [ ] **Step 6: Commit**

```bash
git add packages/content-memory/src/db/migrations/index.ts packages/content-memory/src/index.ts packages/content-memory/tests/migrations-index.test.ts
git commit -m "feat(content-memory): public API and exported migrations"
```

---

## Task 7: Wire build order into the monorepo

**Files:**
- Modify: `package.json:21` (root `build` script)
- Modify: `package.json:23` (root `pretest` script)

`@anubis/conversation` will import `@anubis/content-memory`, so content-memory must build first.

- [ ] **Step 1: Update the `build` script**

In root `package.json`, change the `build` script so `@anubis/content-memory` builds immediately before `@anubis/conversation`. The relevant fragment becomes:

```
... && pnpm --filter @anubis/workflow-runtime build && pnpm --filter @anubis/content-memory build && pnpm --filter @anubis/conversation build && pnpm --filter @anubis/backend build && ...
```

- [ ] **Step 2: Update the `pretest` script**

In root `package.json`, apply the same insertion to `pretest`:

```
... && pnpm --filter @anubis/workflow-runtime build && pnpm --filter @anubis/content-memory build && pnpm --filter @anubis/conversation build && pnpm --filter @anubis/backend build && ...
```

- [ ] **Step 3: Verify the build order resolves**

Run: `pnpm --filter @anubis/content-memory build && pnpm --filter @anubis/conversation build`
Expected: both succeed (conversation can't import content-memory yet — that's Task 8 — but the order must work).

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: build @anubis/content-memory before @anubis/conversation"
```

---

## Task 8: Register migrations + repos in `@anubis/conversation`

**Files:**
- Modify: `packages/conversation/package.json:18-27` (add dependency)
- Modify: `packages/conversation/src/db/migrations/index.ts`
- Create: `packages/conversation/src/db/migrations/010_competitors_workspace.sql`
- Modify: `packages/conversation/src/index.ts`
- Test: `packages/conversation/tests/db/competitors-workspace.test.ts`

- [ ] **Step 1: Add the workspace dependency**

In `packages/conversation/package.json`, add to `dependencies` (keep alphabetical with the other `@anubis/*` entries):

```json
    "@anubis/content-memory": "workspace:*",
```

Then run: `pnpm install`
Expected: completes; conversation now resolves `@anubis/content-memory`.

- [ ] **Step 2: Write the failing test**

Create `packages/conversation/tests/db/competitors-workspace.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_WORKSPACE_ID } from '@anubis/content-memory'
import { openDatabase } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { CompetitorsRepo } from '../../src/db/repositories/competitors-repo.js'

function migUpTo(version: number) {
  return MIGRATIONS.filter((m) => m.version <= version)
}

describe('competitors workspace scoping', () => {
  it('a new competitor defaults to the default workspace', () => {
    const db = openDatabase(':memory:')
    runMigrations(db, MIGRATIONS)
    const repo = new CompetitorsRepo(db)
    repo.insert({
      id: 'c1', handle: '@a', postCount: 0, addedAt: 1, updatedAt: 1,
    })
    expect(repo.findById('c1')?.workspaceId).toBe(DEFAULT_WORKSPACE_ID)
  })

  it('backfills legacy competitor rows to the default workspace (migration 010)', () => {
    const db = openDatabase(':memory:')
    // Apply everything EXCEPT the competitors ALTER — simulates a legacy DB.
    runMigrations(db, migUpTo(9))
    db.prepare(`
      INSERT INTO competitors (id, handle, post_count, added_at, updated_at)
      VALUES ('legacy', '@old', 0, 1, 1)
    `).run()
    // Now apply migration 010.
    runMigrations(db, MIGRATIONS)
    const row = db.prepare('SELECT workspace_id FROM competitors WHERE id = ?').get('legacy') as
      | { workspace_id: string | null }
      | undefined
    expect(row?.workspace_id).toBe(DEFAULT_WORKSPACE_ID)
  })

  it('preserves an explicitly set workspaceId', () => {
    const db = openDatabase(':memory:')
    runMigrations(db, MIGRATIONS)
    const repo = new CompetitorsRepo(db)
    repo.insert({
      id: 'c2', handle: '@b', postCount: 0, addedAt: 1, updatedAt: 1,
      workspaceId: 'default-workspace',
    })
    expect(repo.findById('c2')?.workspaceId).toBe('default-workspace')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run packages/conversation/tests/db/competitors-workspace.test.ts`
Expected: FAIL — `010_competitors_workspace.sql` not registered / `workspaceId` not on `Competitor`.

- [ ] **Step 4: Create the competitors ALTER migration**

Create `packages/conversation/src/db/migrations/010_competitors_workspace.sql`:

```sql
-- Brand owns its competitor set. Added nullable with a NULL default so SQLite
-- permits the REFERENCES clause under foreign_keys=ON; then backfill legacy rows.
ALTER TABLE competitors
  ADD COLUMN workspace_id TEXT REFERENCES content_workspaces(id) DEFAULT NULL;

UPDATE competitors
  SET workspace_id = 'default-workspace'
  WHERE workspace_id IS NULL;

CREATE INDEX idx_competitors_workspace
  ON competitors(workspace_id) WHERE deleted_at IS NULL;
```

- [ ] **Step 5: Register content-memory migrations + 010 in conversation's runner**

Replace `packages/conversation/src/db/migrations/index.ts` with:

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { CONTENT_MEMORY_MIGRATIONS } from '@anubis/content-memory'
import type { Migration } from '../migrate.js'

const here = dirname(fileURLToPath(import.meta.url))

function load(version: number, file: string): Migration {
  return { version, sql: readFileSync(join(here, file), 'utf8') }
}

export const MIGRATIONS: Migration[] = [
  load(1, '001_init.sql'),
  load(2, '002_competitors.sql'),
  load(3, '003_captured_posts.sql'),
  load(4, '004_workflows.sql'),
  load(5, '005_competitors_bio_level.sql'),
  load(6, '006_workflow_triggers.sql'),
  load(7, '007_known_workspaces.sql'),
  // content-memory owns 8–9 (content_workspaces, knowledge_documents).
  ...CONTENT_MEMORY_MIGRATIONS,
  // 010 alters competitors and depends on content_workspaces existing (8).
  load(10, '010_competitors_workspace.sql'),
]
```

Note: `CONTENT_MEMORY_MIGRATIONS` already carry `version: 8` and `9`. `runMigrations` sorts by version, so the array order here is for readability; correctness comes from the version numbers.

- [ ] **Step 6: Add `workspaceId` to the competitors repo**

In `packages/conversation/src/db/repositories/competitors-repo.ts`:

Add to the `Competitor` interface (after `level?`):

```ts
  workspaceId?: string
```

Add to the `Row` interface (after `level: string | null`):

```ts
  workspace_id: string | null
```

In `toCompetitor`, add (after the `level:` line):

```ts
    workspaceId: r.workspace_id ?? undefined,
```

Replace the `insert` method's SQL + params to include `workspace_id` (defaulting to the well-known id):

```ts
  insert(c: Competitor): void {
    this.db.prepare(`
      INSERT INTO competitors (
        id, handle, display_name, niche, tint, followers, avg_likes,
        post_count, last_refreshed_at, notes, bio, level, workspace_id,
        added_at, updated_at, deleted_at
      ) VALUES (
        @id, @handle, @displayName, @niche, @tint, @followers, @avgLikes,
        @postCount, @lastRefreshedAt, @notes, @bio, @level, @workspaceId,
        @addedAt, @updatedAt, @deletedAt
      )
    `).run({
      id: c.id,
      handle: c.handle,
      displayName: c.displayName ?? null,
      niche: c.niche ?? null,
      tint: c.tint ?? null,
      followers: c.followers ?? null,
      avgLikes: c.avgLikes ?? null,
      postCount: c.postCount,
      lastRefreshedAt: c.lastRefreshedAt ?? null,
      notes: c.notes ?? null,
      bio: c.bio ?? null,
      level: c.level ?? null,
      workspaceId: c.workspaceId ?? 'default-workspace',
      addedAt: c.addedAt,
      updatedAt: c.updatedAt,
      deletedAt: c.deletedAt ?? null,
    })
  }
```

Note: `update()` is intentionally left untouched — re-assigning a competitor's workspace is out of scope for Phase 1.

- [ ] **Step 7: Expose the new repos/service on `ConversationStack`**

In `packages/conversation/src/index.ts`:

Add imports near the other `@anubis/*` imports (top of file):

```ts
import {
  ContentWorkspacesRepo,
  ContentWorkspacesService,
  KnowledgeDocumentsRepo,
} from '@anubis/content-memory'
```

Add to the `ConversationStack` interface (after `knownWorkspaces: KnownWorkspacesRepo`):

```ts
  contentWorkspaces: ContentWorkspacesService
  knowledgeDocuments: KnowledgeDocumentsRepo
```

In `createConversationService`, after `const knownWorkspacesRepo = new KnownWorkspacesRepo(db)`:

```ts
  const contentWorkspaces = new ContentWorkspacesService(new ContentWorkspacesRepo(db))
  const knowledgeDocuments = new KnowledgeDocumentsRepo(db)
```

Add both to the returned object (in the final `return { ... }`, alongside `knownWorkspaces`):

```ts
    contentWorkspaces,
    knowledgeDocuments,
```

Add re-exports at the bottom of the file (with the other `export type`/`export` lines):

```ts
export type { ContentWorkspace, KnowledgeDocument, ScoredDocument } from '@anubis/content-memory'
export { DEFAULT_WORKSPACE_ID } from '@anubis/content-memory'
```

- [ ] **Step 8: Run the new test to verify it passes**

Run: `pnpm vitest run packages/conversation/tests/db/competitors-workspace.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Run the full conversation suite to check for regressions**

Run: `pnpm vitest run packages/conversation`
Expected: all tests pass (existing competitor/captured-post tests still green — the new column is additive with a default).

- [ ] **Step 10: Typecheck both packages**

Run: `pnpm --filter @anubis/content-memory typecheck && pnpm --filter @anubis/conversation typecheck`
Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add packages/conversation/package.json packages/conversation/src/db/migrations/index.ts packages/conversation/src/db/migrations/010_competitors_workspace.sql packages/conversation/src/db/repositories/competitors-repo.ts packages/conversation/src/index.ts packages/conversation/tests/db/competitors-workspace.test.ts pnpm-lock.yaml
git commit -m "feat(conversation): scope competitors to brand workspace + expose content-memory repos"
```

---

## Task 9: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Build the two packages in order**

Run: `pnpm --filter @anubis/content-memory build && pnpm --filter @anubis/conversation build`
Expected: both succeed; content-memory prints the SQL-copy line.

- [ ] **Step 2: Run the content-memory test suite**

Run: `pnpm vitest run packages/content-memory`
Expected: all tests pass (types, content-workspaces repo + service, knowledge-documents, migrations-index).

- [ ] **Step 3: Run the conversation test suite**

Run: `pnpm vitest run packages/conversation`
Expected: all green.

- [ ] **Step 4: Repo-wide typecheck**

Run: `pnpm typecheck`
Expected: no errors across packages.

- [ ] **Step 5: Final commit (if any artifacts changed)**

```bash
git add -A
git commit -m "test(content-memory): phase 1 foundation verified" --allow-empty
```

---

## Self-review (completed against the design + original spec)

**Spec coverage (design §8 Phase 1):**
- Package skeleton → Task 1. Build order → Task 7.
- `content_workspaces` brand entity (design §4.1) → Task 3.
- `competitors.workspace_id` + default-brand backfill (design §4.2) → Task 8 (migration 010 + repo + tests).
- Scoped retrieval with scope-before-rank (original spec §11, design §6) → Task 4 (`KnowledgeDocumentsRepo.search`).
- Isolation tests (original spec §22.1–§22.3) → Task 4. Default/backfill tests → Task 8.
- Exposed on `ConversationStack` → Task 8.

**Deliberately deferred (own later plans):** embeddings/vectors, `knowledge_chunks`, `content_similarity_items` + ingestion from `captured_posts`, `ContentContextPack`, `experience_memories`, validators, HTTP routes, workflow nodes. Phase 1 proves isolation with lexical search; Phase 2 adds the local embedder and replaces lexical scoring with semantic ranking behind the same `search()` surface.

**Type consistency:** `Db`/`Migration` defined in `src/db/types.ts` (Task 2) and reused everywhere; `ContentWorkspace` shape identical across repo (Task 3), service (Task 5), and exports (Task 6); `NewKnowledgeDocument`/`ScoredDocument`/`SearchKnowledgeInput` defined in Task 4 and re-exported in Task 6; `DEFAULT_WORKSPACE_ID = 'default-workspace'` is the single source used by the SQL seed (Task 3), the SQL backfill (Task 8), the repo insert default (Task 8), and the tests.

**Placeholder scan:** no TBD/TODO/"handle edge cases"/"similar to" — every code and SQL step is complete.

**Known couplings (documented, accepted):**
1. content-memory hardcodes migration versions 8–9; conversation owns 10. Adding future conversation-only migrations must avoid those numbers (next free is 11+).
2. Migration 010 (conversation) references `content_workspaces`, created by content-memory's migration 8 — ordering is guaranteed by version sort.
3. `competitors.workspace_id` is nullable at the DB level (SQLite ALTER + FK constraint requires a NULL default); non-null is enforced in the app layer via the repo insert default.

---

## Execution handoff

Phases 2–5 (embeddings + similarity ingestion, context pack, experience index, validators + wiring) each get their own plan after this foundation lands, per the design doc's §8 phasing.
