# Scoped Content Memory — Phase 4 (Experience Index) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. **Prerequisite: Phases 1–3 merged.**

**Goal:** Let the system learn from review feedback — persist mistakes/corrections/rules as `experience_memories`, promote candidates to active, and recall active memories into the context pack's `experienceMemory` section so future generations avoid past mistakes.

**Architecture:** `experience_memories` table + repo + `ExperienceIndexService` (`recordCandidate`, `saveFeedback`, `promote`, `deprecate`, `recallActive`). `ContextPackService` gains an optional `experience` dependency; when present it recalls active/reinforced memories (scope = brand OR global, platform-matched) and fills the previously-empty `experienceMemory` section + citations. A feedback HTTP route persists reviewer feedback as a candidate memory.

**Tech Stack:** TypeScript (ESM, NodeNext), better-sqlite3, Hono, Vitest.

**Reference:** design `2026-06-05-scoped-content-memory-design.md` (§4.5, this implements §8 Phase 4); original spec §9.4 (`experience_memories`), §16.5 (`saveFeedback`), §19 (feedback loop).

---

## Scope of this phase

In scope:
- `experience_memories` (migration 014) + `ExperienceMemoriesRepo`.
- `ExperienceIndexService`: `recordCandidate`, `saveFeedback`, `promote`, `deprecate`, `recallActive`.
- Wire the `experienceMemory` section + experience citations into `ContextPackService`.
- `POST /content-memory/feedback` and `POST /content-memory/memories/:id/promote` routes.
- Tests: candidate lifecycle, scoped recall, context-pack recall integration.

Out of scope (later / separate): workflow `lessonWriter`/`lessonReader` nodes and the rejection→regenerate loop (need the pending durable engine — they call `ExperienceIndexService`, so the service is the durable seam); validators (Phase 5); `agent_runs` (Phase 5). `saveFeedback.runId` is stored as a plain string (no FK) so this phase does not depend on `agent_runs`.

**Migration bookkeeping:** content-memory owns 008/009/011/012/013 and now **014**. `CONTENT_MEMORY_MIGRATIONS` → `[8, 9, 11, 12, 13, 14]`.

---

## File structure

New in `packages/content-memory/`:
```
src/db/migrations/014_experience_memories.sql
src/db/repositories/experience-memories-repo.ts
src/experience/experience-index-service.ts
tests/experience-memories-repo.test.ts
tests/experience-index-service.test.ts
```
Modified in `packages/content-memory/`:
```
src/types.ts                                       # ExperienceType, ExperienceScope, Severity, MemoryStatus
src/context-pack/context-pack-service.ts           # optional experience dep + section fill
src/db/migrations/index.ts                          # + 014
src/index.ts                                        # exports
tests/migrations-index.test.ts                      # expect [8,9,11,12,13,14]
tests/context-pack-service.test.ts                  # recall assertion
```
Modified in `packages/conversation/` + `packages/backend/`:
```
packages/conversation/src/index.ts                  # instantiate experience, pass into ContextPackService, expose
packages/backend/src/content-memory.ts              # feedback + promote routes
```

---

## Task 1: Experience enums

**Files:**
- Modify: `packages/content-memory/src/types.ts`
- Test: `packages/content-memory/tests/types.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `packages/content-memory/tests/types.test.ts`:

```ts
import { EXPERIENCE_TYPES, SEVERITIES, MEMORY_STATUSES } from '../src/types.js'

describe('experience enums', () => {
  it('exposes experience types, severities, and statuses', () => {
    expect(EXPERIENCE_TYPES).toContain('mistake')
    expect(EXPERIENCE_TYPES).toContain('validation_rule')
    expect(SEVERITIES).toEqual(['low', 'medium', 'high', 'critical'])
    expect(MEMORY_STATUSES).toContain('candidate')
    expect(MEMORY_STATUSES).toContain('active')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/content-memory/tests/types.test.ts`
Expected: FAIL — enums not exported.

- [ ] **Step 3: Add the enums to `src/types.ts`**

Append to `packages/content-memory/src/types.ts`:

```ts
export type ExperienceScope = 'global' | 'workspace' | 'platform' | 'campaign' | 'agent'

export type ExperienceType =
  | 'mistake' | 'correction' | 'workflow_rule'
  | 'validation_rule' | 'preference' | 'anti_pattern' | 'lesson'

export const EXPERIENCE_TYPES: readonly ExperienceType[] = [
  'mistake', 'correction', 'workflow_rule',
  'validation_rule', 'preference', 'anti_pattern', 'lesson',
]

export type Severity = 'low' | 'medium' | 'high' | 'critical'
export const SEVERITIES: readonly Severity[] = ['low', 'medium', 'high', 'critical']

export type MemoryStatus = 'candidate' | 'active' | 'reinforced' | 'deprecated' | 'rejected'
export const MEMORY_STATUSES: readonly MemoryStatus[] = [
  'candidate', 'active', 'reinforced', 'deprecated', 'rejected',
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/content-memory/tests/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/content-memory/src/types.ts packages/content-memory/tests/types.test.ts
git commit -m "feat(content-memory): experience memory enums"
```

---

## Task 2: `experience_memories` table + repo

**Files:**
- Create: `packages/content-memory/src/db/migrations/014_experience_memories.sql`
- Create: `packages/content-memory/src/db/repositories/experience-memories-repo.ts`
- Test: `packages/content-memory/tests/experience-memories-repo.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/content-memory/tests/experience-memories-repo.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { freshDb } from './helpers/db.js'
import { BrandWorkspacesRepo } from '../src/db/repositories/brand-workspaces-repo.js'
import {
  ExperienceMemoriesRepo,
  type ExperienceMemory,
} from '../src/db/repositories/experience-memories-repo.js'

const here = dirname(fileURLToPath(import.meta.url))
const sqlFor = (f: string) => readFileSync(join(here, '../src/db/migrations', f), 'utf8')
const migrations = [
  { version: 8, sql: sqlFor('008_brand_workspaces.sql') },
  { version: 14, sql: sqlFor('014_experience_memories.sql') },
]

function setup() {
  const db = freshDb(migrations)
  const brands = new BrandWorkspacesRepo(db)
  for (const id of ['workspace-a', 'workspace-b']) {
    brands.insert({
      id, name: id, brandSummary: null, toneOfVoice: [], audience: [], offers: [],
      constraints: [], status: 'active', createdAt: 100, updatedAt: 100,
    })
  }
  return new ExperienceMemoriesRepo(db)
}

function mem(over: Partial<ExperienceMemory>): ExperienceMemory {
  return {
    id: over.id ?? `m-${Math.random().toString(36).slice(2)}`,
    scope: over.scope ?? 'workspace',
    workspaceId: over.workspaceId ?? 'workspace-a',
    platform: over.platform ?? null,
    campaignId: over.campaignId ?? null,
    agentId: over.agentId ?? null,
    type: over.type ?? 'mistake',
    title: over.title ?? 'Avoid fear hooks',
    problem: over.problem ?? 'used a fear hook',
    cause: over.cause ?? null,
    correction: over.correction ?? 'use a soft educational hook',
    triggerPattern: over.triggerPattern ?? null,
    preventionRule: over.preventionRule ?? null,
    severity: over.severity ?? 'medium',
    status: over.status ?? 'candidate',
    usageCount: over.usageCount ?? 0,
    successCount: over.successCount ?? 0,
    failureCount: over.failureCount ?? 0,
    confidence: over.confidence ?? 0,
    sourceRunId: over.sourceRunId ?? null,
    sourceDocumentId: over.sourceDocumentId ?? null,
    createdAt: over.createdAt ?? 100,
    updatedAt: over.updatedAt ?? 100,
  }
}

describe('ExperienceMemoriesRepo', () => {
  it('inserts and reads a memory', () => {
    const repo = setup()
    repo.insert(mem({ id: 'm1' }))
    expect(repo.findById('m1')?.title).toBe('Avoid fear hooks')
  })

  it('setStatus promotes a candidate to active', () => {
    const repo = setup()
    repo.insert(mem({ id: 'm1', status: 'candidate' }))
    repo.setStatus('m1', 'active')
    expect(repo.findById('m1')?.status).toBe('active')
  })

  it('recallActive returns active/reinforced for the workspace or global, scoped', () => {
    const repo = setup()
    repo.insert(mem({ id: 'active-a', workspaceId: 'workspace-a', status: 'active' }))
    repo.insert(mem({ id: 'cand-a', workspaceId: 'workspace-a', status: 'candidate' }))
    repo.insert(mem({ id: 'active-b', workspaceId: 'workspace-b', status: 'active' }))
    repo.insert(mem({ id: 'global', scope: 'global', workspaceId: null, status: 'reinforced' }))

    const got = repo.recallActive({ workspaceId: 'workspace-a', platform: 'instagram' })
    const ids = got.map((m) => m.id)
    expect(ids).toContain('active-a')
    expect(ids).toContain('global')
    expect(ids).not.toContain('cand-a')     // candidates excluded
    expect(ids).not.toContain('active-b')   // other workspace excluded
  })

  it('recallActive excludes a TikTok-only memory for an Instagram task', () => {
    const repo = setup()
    repo.insert(mem({ id: 'tt', workspaceId: 'workspace-a', status: 'active', platform: 'tiktok' }))
    const got = repo.recallActive({ workspaceId: 'workspace-a', platform: 'instagram' })
    expect(got.map((m) => m.id)).not.toContain('tt')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/content-memory/tests/experience-memories-repo.test.ts`
Expected: FAIL — migration / repo missing.

- [ ] **Step 3: Create the migration**

Create `packages/content-memory/src/db/migrations/014_experience_memories.sql`:

```sql
CREATE TABLE experience_memories (
  id                 TEXT PRIMARY KEY,
  scope              TEXT NOT NULL CHECK (scope IN ('global','workspace','platform','campaign','agent')),
  workspace_id       TEXT REFERENCES brand_workspaces(id),
  platform           TEXT,
  campaign_id        TEXT,
  agent_id           TEXT,
  type               TEXT NOT NULL CHECK (type IN
                       ('mistake','correction','workflow_rule','validation_rule','preference','anti_pattern','lesson')),
  title              TEXT NOT NULL,
  problem            TEXT NOT NULL,
  cause              TEXT,
  correction         TEXT NOT NULL,
  trigger_pattern    TEXT,
  prevention_rule    TEXT,
  severity           TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  status             TEXT NOT NULL CHECK (status IN ('candidate','active','reinforced','deprecated','rejected')),
  usage_count        INTEGER NOT NULL DEFAULT 0,
  success_count      INTEGER NOT NULL DEFAULT 0,
  failure_count      INTEGER NOT NULL DEFAULT 0,
  confidence         REAL NOT NULL DEFAULT 0,
  source_run_id      TEXT,
  source_document_id TEXT,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);
CREATE INDEX idx_experience_workspace_status ON experience_memories(workspace_id, status);
CREATE INDEX idx_experience_platform ON experience_memories(platform);
```

- [ ] **Step 4: Create the repo**

Create `packages/content-memory/src/db/repositories/experience-memories-repo.ts`:

```ts
import type { Db } from '../types.js'
import type {
  ExperienceScope, ExperienceType, MemoryStatus, Platform, Severity,
} from '../../types.js'

export interface ExperienceMemory {
  id: string
  scope: ExperienceScope
  workspaceId: string | null
  platform: Platform | null
  campaignId: string | null
  agentId: string | null
  type: ExperienceType
  title: string
  problem: string
  cause: string | null
  correction: string
  triggerPattern: string | null
  preventionRule: string | null
  severity: Severity
  status: MemoryStatus
  usageCount: number
  successCount: number
  failureCount: number
  confidence: number
  sourceRunId: string | null
  sourceDocumentId: string | null
  createdAt: number
  updatedAt: number
}

export interface RecallActiveInput {
  workspaceId: string
  platform?: Platform | null
  limit?: number
}

interface Row {
  id: string
  scope: string
  workspace_id: string | null
  platform: string | null
  campaign_id: string | null
  agent_id: string | null
  type: string
  title: string
  problem: string
  cause: string | null
  correction: string
  trigger_pattern: string | null
  prevention_rule: string | null
  severity: string
  status: string
  usage_count: number
  success_count: number
  failure_count: number
  confidence: number
  source_run_id: string | null
  source_document_id: string | null
  created_at: number
  updated_at: number
}

function toMemory(r: Row): ExperienceMemory {
  return {
    id: r.id,
    scope: r.scope as ExperienceScope,
    workspaceId: r.workspace_id,
    platform: (r.platform as Platform | null) ?? null,
    campaignId: r.campaign_id,
    agentId: r.agent_id,
    type: r.type as ExperienceType,
    title: r.title,
    problem: r.problem,
    cause: r.cause,
    correction: r.correction,
    triggerPattern: r.trigger_pattern,
    preventionRule: r.prevention_rule,
    severity: r.severity as Severity,
    status: r.status as MemoryStatus,
    usageCount: r.usage_count,
    successCount: r.success_count,
    failureCount: r.failure_count,
    confidence: r.confidence,
    sourceRunId: r.source_run_id,
    sourceDocumentId: r.source_document_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export class ExperienceMemoriesRepo {
  constructor(private db: Db) {}

  insert(m: ExperienceMemory): void {
    this.db.prepare(`
      INSERT INTO experience_memories (
        id, scope, workspace_id, platform, campaign_id, agent_id, type, title,
        problem, cause, correction, trigger_pattern, prevention_rule, severity,
        status, usage_count, success_count, failure_count, confidence,
        source_run_id, source_document_id, created_at, updated_at
      ) VALUES (
        @id, @scope, @workspaceId, @platform, @campaignId, @agentId, @type, @title,
        @problem, @cause, @correction, @triggerPattern, @preventionRule, @severity,
        @status, @usageCount, @successCount, @failureCount, @confidence,
        @sourceRunId, @sourceDocumentId, @createdAt, @updatedAt
      )
    `).run({
      id: m.id,
      scope: m.scope,
      workspaceId: m.workspaceId ?? null,
      platform: m.platform ?? null,
      campaignId: m.campaignId ?? null,
      agentId: m.agentId ?? null,
      type: m.type,
      title: m.title,
      problem: m.problem,
      cause: m.cause ?? null,
      correction: m.correction,
      triggerPattern: m.triggerPattern ?? null,
      preventionRule: m.preventionRule ?? null,
      severity: m.severity,
      status: m.status,
      usageCount: m.usageCount,
      successCount: m.successCount,
      failureCount: m.failureCount,
      confidence: m.confidence,
      sourceRunId: m.sourceRunId ?? null,
      sourceDocumentId: m.sourceDocumentId ?? null,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    })
  }

  findById(id: string): ExperienceMemory | null {
    const r = this.db.prepare('SELECT * FROM experience_memories WHERE id = ?').get(id) as
      | Row | undefined
    return r ? toMemory(r) : null
  }

  setStatus(id: string, status: MemoryStatus, now: number = Date.now()): void {
    this.db
      .prepare('UPDATE experience_memories SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now, id)
  }

  recallActive(input: RecallActiveInput): ExperienceMemory[] {
    const rows = this.db.prepare(`
      SELECT * FROM experience_memories
      WHERE status IN ('active', 'reinforced')
        AND (workspace_id = @workspaceId OR workspace_id IS NULL)
        AND (@platform IS NULL OR platform IS NULL OR platform = @platform)
      ORDER BY confidence DESC, updated_at DESC
    `).all({
      workspaceId: input.workspaceId,
      platform: input.platform ?? null,
    }) as Row[]
    const mapped = rows.map(toMemory)
    return typeof input.limit === 'number' ? mapped.slice(0, input.limit) : mapped
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/content-memory/tests/experience-memories-repo.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/content-memory/src/db/migrations/014_experience_memories.sql packages/content-memory/src/db/repositories/experience-memories-repo.ts packages/content-memory/tests/experience-memories-repo.test.ts
git commit -m "feat(content-memory): experience_memories store with scoped recall"
```

---

## Task 3: `ExperienceIndexService`

**Files:**
- Create: `packages/content-memory/src/experience/experience-index-service.ts`
- Test: `packages/content-memory/tests/experience-index-service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/content-memory/tests/experience-index-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { freshDb } from './helpers/db.js'
import { BrandWorkspacesRepo } from '../src/db/repositories/brand-workspaces-repo.js'
import { ExperienceMemoriesRepo } from '../src/db/repositories/experience-memories-repo.js'
import { ExperienceIndexService } from '../src/experience/experience-index-service.js'

const here = dirname(fileURLToPath(import.meta.url))
const sqlFor = (f: string) => readFileSync(join(here, '../src/db/migrations', f), 'utf8')
const migrations = [
  { version: 8, sql: sqlFor('008_brand_workspaces.sql') },
  { version: 14, sql: sqlFor('014_experience_memories.sql') },
]

function setup() {
  const db = freshDb(migrations)
  new BrandWorkspacesRepo(db).insert({
    id: 'workspace-a', name: 'A', brandSummary: null, toneOfVoice: [], audience: [],
    offers: [], constraints: [], status: 'active', createdAt: 100, updatedAt: 100,
  })
  const repo = new ExperienceMemoriesRepo(db)
  return { repo, svc: new ExperienceIndexService(repo) }
}

describe('ExperienceIndexService', () => {
  it('recordCandidate creates a candidate memory', () => {
    const { svc } = setup()
    const m = svc.recordCandidate({
      workspaceId: 'workspace-a', type: 'mistake',
      title: 'Fear hook', problem: 'used fear', correction: 'use soft hook',
    })
    expect(m.status).toBe('candidate')
    expect(m.severity).toBe('medium')   // default
  })

  it('saveFeedback with a bad rating creates a candidate mistake', () => {
    const { svc, repo } = setup()
    const m = svc.saveFeedback({
      runId: 'run-1', workspaceId: 'workspace-a', rating: 'bad',
      feedback: 'This brand never uses fear-based hooks.',
    })
    expect(m).not.toBeNull()
    expect(repo.findById(m!.id)?.sourceRunId).toBe('run-1')
    expect(m!.type).toBe('mistake')
  })

  it('saveFeedback with a good rating creates nothing by default', () => {
    const { svc } = setup()
    const m = svc.saveFeedback({
      runId: 'run-2', workspaceId: 'workspace-a', rating: 'good', feedback: 'great',
    })
    expect(m).toBeNull()
  })

  it('promote moves a candidate to active and it then recalls', () => {
    const { svc } = setup()
    const m = svc.recordCandidate({
      workspaceId: 'workspace-a', type: 'workflow_rule',
      title: 'Check hooks', problem: 'p', correction: 'c',
      preventionRule: 'check workspace hook restrictions',
    })
    expect(svc.recallActive({ workspaceId: 'workspace-a', platform: 'instagram' })).toHaveLength(0)
    svc.promote(m.id)
    const active = svc.recallActive({ workspaceId: 'workspace-a', platform: 'instagram' })
    expect(active.map((x) => x.id)).toContain(m.id)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/content-memory/tests/experience-index-service.test.ts`
Expected: FAIL — service not found.

- [ ] **Step 3: Create the service**

Create `packages/content-memory/src/experience/experience-index-service.ts`:

```ts
import { randomUUID } from 'node:crypto'
import type { ExperienceScope, ExperienceType, Platform, Severity } from '../types.js'
import type {
  ExperienceMemoriesRepo, ExperienceMemory, RecallActiveInput,
} from '../db/repositories/experience-memories-repo.js'

export interface RecordExperienceInput {
  scope?: ExperienceScope
  workspaceId?: string | null
  platform?: Platform | null
  campaignId?: string | null
  agentId?: string | null
  type: ExperienceType
  title: string
  problem: string
  cause?: string | null
  correction: string
  triggerPattern?: string | null
  preventionRule?: string | null
  severity?: Severity
  sourceRunId?: string | null
  sourceDocumentId?: string | null
}

export interface SaveFeedbackInput {
  runId: string
  workspaceId: string
  platform?: Platform | null
  rating: 'good' | 'bad' | 'partial'
  feedback: string
  /** Default: create a memory unless rating === 'good'. */
  createExperienceMemory?: boolean
  memoryType?: ExperienceType
  severity?: Severity
}

export class ExperienceIndexService {
  constructor(private repo: ExperienceMemoriesRepo) {}

  recordCandidate(input: RecordExperienceInput, now: number = Date.now()): ExperienceMemory {
    const scope: ExperienceScope = input.scope ?? 'workspace'
    const m: ExperienceMemory = {
      id: randomUUID(),
      scope,
      workspaceId: scope === 'global' ? null : (input.workspaceId ?? null),
      platform: input.platform ?? null,
      campaignId: input.campaignId ?? null,
      agentId: input.agentId ?? null,
      type: input.type,
      title: input.title,
      problem: input.problem,
      cause: input.cause ?? null,
      correction: input.correction,
      triggerPattern: input.triggerPattern ?? null,
      preventionRule: input.preventionRule ?? null,
      severity: input.severity ?? 'medium',
      status: 'candidate',
      usageCount: 0,
      successCount: 0,
      failureCount: 0,
      confidence: 0,
      sourceRunId: input.sourceRunId ?? null,
      sourceDocumentId: input.sourceDocumentId ?? null,
      createdAt: now,
      updatedAt: now,
    }
    this.repo.insert(m)
    return m
  }

  saveFeedback(input: SaveFeedbackInput, now: number = Date.now()): ExperienceMemory | null {
    const shouldCreate = input.createExperienceMemory ?? input.rating !== 'good'
    if (!shouldCreate) return null
    const type: ExperienceType = input.memoryType ?? (input.rating === 'bad' ? 'mistake' : 'lesson')
    return this.recordCandidate({
      workspaceId: input.workspaceId,
      platform: input.platform ?? null,
      type,
      title: input.feedback.slice(0, 80),
      problem: input.feedback,
      correction: input.feedback,
      severity: input.severity ?? 'medium',
      sourceRunId: input.runId,
    }, now)
  }

  promote(id: string, now: number = Date.now()): void {
    this.repo.setStatus(id, 'active', now)
  }

  deprecate(id: string, now: number = Date.now()): void {
    this.repo.setStatus(id, 'deprecated', now)
  }

  recallActive(input: RecallActiveInput): ExperienceMemory[] {
    return this.repo.recallActive(input)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/content-memory/tests/experience-index-service.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/content-memory/src/experience/experience-index-service.ts packages/content-memory/tests/experience-index-service.test.ts
git commit -m "feat(content-memory): ExperienceIndexService"
```

---

## Task 4: Recall experience into the context pack

**Files:**
- Modify: `packages/content-memory/src/context-pack/context-pack-service.ts`
- Test: `packages/content-memory/tests/context-pack-service.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `packages/content-memory/tests/context-pack-service.test.ts`:

Add to the migration list at the top of the file:

```ts
  { version: 14, sql: sqlFor('014_experience_memories.sql') },
```

Add these imports:

```ts
import { ExperienceMemoriesRepo } from '../src/db/repositories/experience-memories-repo.js'
import { ExperienceIndexService } from '../src/experience/experience-index-service.js'
```

Add a new test (the existing `setup()` builds a service without experience; this
builds one with it):

```ts
describe('ContextPackService experience recall', () => {
  it('fills experienceMemory.previousMistakes from active memories', async () => {
    const db = freshDb(migrations)
    const brands = new BrandWorkspacesRepo(db)
    brands.insert({
      id: 'workspace-a', name: 'A', brandSummary: 'B', toneOfVoice: [], audience: [],
      offers: [], constraints: [], status: 'active', createdAt: 100, updatedAt: 100,
    })
    const experienceRepo = new ExperienceMemoriesRepo(db)
    const experience = new ExperienceIndexService(experienceRepo)
    const m = experience.recordCandidate({
      workspaceId: 'workspace-a', type: 'mistake',
      title: 'Fear hook', problem: 'used a fear hook', correction: 'use a soft hook',
    })
    experience.promote(m.id)

    const svc = new ContextPackService({
      brands, docs: new KnowledgeDocumentsRepo(db),
      items: new ContentSimilarityItemsRepo(db), embedder: new FakeEmbedder(),
      experience,
    })
    const pack = await svc.buildContentContextPack({
      workspaceId: 'workspace-a', platform: 'instagram',
      taskType: 'generate_content', query: 'skincare', objective: 'Generate',
    })
    expect(pack.experienceMemory.previousMistakes.join(' ')).toContain('Fear hook')
    expect(pack.citations.some((ci) => ci.sourceType === 'experience_memory')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/content-memory/tests/context-pack-service.test.ts`
Expected: FAIL — `ContextPackDeps` has no `experience`; section stays empty.

- [ ] **Step 3: Add the optional dependency + fill the section**

In `packages/content-memory/src/context-pack/context-pack-service.ts`:

Add the import:

```ts
import type { ExperienceIndexService } from '../experience/experience-index-service.js'
```

Add `experience` to `ContextPackDeps` (optional, so Phase 3 callers still compile):

```ts
export interface ContextPackDeps {
  brands: BrandWorkspacesRepo
  docs: KnowledgeDocumentsRepo
  items: ContentSimilarityItemsRepo
  embedder: Embedder
  experience?: ExperienceIndexService
}
```

Replace the hardcoded `experienceMemory: { …empty… }` block in the returned
`pack` literal with a computed value. First, just before `const pack: ...`,
compute it:

```ts
    const memories = this.deps.experience
      ? this.deps.experience.recallActive({ workspaceId: input.workspaceId, platform: input.platform, limit: 10 })
      : []
    for (const m of memories) {
      citations.push({
        sourceId: m.id, sourceType: 'experience_memory',
        title: m.title, excerpt: m.correction.slice(0, 160),
      })
    }
    const experienceMemory = {
      previousMistakes: memories
        .filter((m) => m.type === 'mistake' || m.type === 'anti_pattern')
        .map((m) => `${m.title}: ${m.problem} → ${m.correction}`),
      reviewerFeedback: memories
        .filter((m) => m.type === 'correction' || m.type === 'preference' || m.type === 'lesson')
        .map((m) => `${m.title}: ${m.correction}`),
      validationRules: memories
        .filter((m) => m.type === 'validation_rule' || m.type === 'workflow_rule')
        .map((m) => m.preventionRule ?? m.correction),
    }
```

Then in the `pack` literal, replace the empty `experienceMemory` object with:

```ts
      experienceMemory,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/content-memory/tests/context-pack-service.test.ts`
Expected: PASS (Phase 3 tests + the new recall test).

- [ ] **Step 5: Commit**

```bash
git add packages/content-memory/src/context-pack/context-pack-service.ts packages/content-memory/tests/context-pack-service.test.ts
git commit -m "feat(content-memory): recall active experience memories into the context pack"
```

---

## Task 5: Register migration 014 + exports

**Files:**
- Modify: `packages/content-memory/src/db/migrations/index.ts`
- Modify: `packages/content-memory/src/index.ts`
- Modify: `packages/content-memory/tests/migrations-index.test.ts`

- [ ] **Step 1: Update the migrations-index test (expect 14)**

Replace the assertion in `packages/content-memory/tests/migrations-index.test.ts`:

```ts
    const versions = CONTENT_MEMORY_MIGRATIONS.map((m) => m.version)
    expect(versions).toEqual([8, 9, 11, 12, 13, 14])
```

- [ ] **Step 2: Register migration 014**

In `packages/content-memory/src/db/migrations/index.ts`, append to the array:

```ts
  load(14, '014_experience_memories.sql'),
```

- [ ] **Step 3: Add public exports**

Append to `packages/content-memory/src/index.ts`:

```ts
export type {
  ExperienceScope, ExperienceType, Severity, MemoryStatus,
} from './types.js'
export { EXPERIENCE_TYPES, SEVERITIES, MEMORY_STATUSES } from './types.js'

export type { ExperienceMemory, RecallActiveInput } from './db/repositories/experience-memories-repo.js'
export { ExperienceMemoriesRepo } from './db/repositories/experience-memories-repo.js'

export type {
  RecordExperienceInput, SaveFeedbackInput,
} from './experience/experience-index-service.js'
export { ExperienceIndexService } from './experience/experience-index-service.js'
```

- [ ] **Step 4: Run tests + typecheck + build**

Run: `pnpm vitest run packages/content-memory`
Expected: all pass.

Run: `pnpm --filter @anubis/content-memory typecheck && pnpm --filter @anubis/content-memory build`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/content-memory/src/db/migrations/index.ts packages/content-memory/src/index.ts packages/content-memory/tests/migrations-index.test.ts
git commit -m "feat(content-memory): register experience migration + exports"
```

---

## Task 6: Wire experience into the stack + feedback routes

**Files:**
- Modify: `packages/conversation/src/index.ts`
- Modify: `packages/backend/src/content-memory.ts`
- Test: `packages/conversation/tests/content-memory-stack.test.ts` (extend)

- [ ] **Step 1: Write the failing stack test**

Append to `packages/conversation/tests/content-memory-stack.test.ts` (inside the
same `describe`), reusing the `createConversationService` setup pattern — add an
assertion that `stack.experience` exists and round-trips:

```ts
  it('exposes experience and records + promotes a memory', async () => {
    dir = mkdtempSync(join(tmpdir(), 'anubis-cm-'))
    const builtin = getBuiltinSkillRoots()
    stack = createConversationService({
      dataDir: dir,
      skillRoots: {
        autoInject: builtin.autoInject, optIn: builtin.optIn,
        user: join(dir, 'skills'), userAutoInject: join(dir, 'skills', 'auto-inject'),
        userOptIn: join(dir, 'skills', 'opt-in'),
      },
    })
    const m = stack.experience.recordCandidate({
      workspaceId: 'default-workspace', type: 'mistake',
      title: 't', problem: 'p', correction: 'c',
    })
    stack.experience.promote(m.id)
    const active = stack.experience.recallActive({
      workspaceId: 'default-workspace', platform: 'instagram',
    })
    expect(active.map((x) => x.id)).toContain(m.id)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/conversation/tests/content-memory-stack.test.ts`
Expected: FAIL — `stack.experience` undefined.

- [ ] **Step 3: Wire experience onto the stack**

In `packages/conversation/src/index.ts`:

Extend the `@anubis/content-memory` import:

```ts
  ExperienceIndexService,
  ExperienceMemoriesRepo,
```

Add to the `ConversationStack` interface (after `contentMemory`):

```ts
  experience: ExperienceIndexService
```

In `createConversationService`, before building `contextPack`, construct the
experience service, then pass it into `ContextPackService`:

```ts
  const experience = new ExperienceIndexService(new ExperienceMemoriesRepo(db))
  const contextPack = new ContextPackService({
    brands: new BrandWorkspacesRepo(db),
    docs: knowledgeDocuments,
    items: similarityItems,
    embedder: contentEmbedder,
    experience,
  })
```

(Replace the Phase 3 `contextPack` construction with this experience-aware one.)

Add to the returned object:

```ts
    experience,
```

- [ ] **Step 4: Add the feedback + promote routes**

Append to `packages/backend/src/content-memory.ts`:

```ts
const SEVERITY = z.enum(['low', 'medium', 'high', 'critical'])
const MEMORY_TYPE = z.enum([
  'mistake', 'correction', 'workflow_rule', 'validation_rule',
  'preference', 'anti_pattern', 'lesson',
])

const FeedbackBody = z.object({
  runId: z.string().min(1),
  workspaceId: z.string().min(1),
  platform: PLATFORM.optional(),
  rating: z.enum(['good', 'bad', 'partial']),
  feedback: z.string().min(1),
  createExperienceMemory: z.boolean().optional(),
  memoryType: MEMORY_TYPE.optional(),
  severity: SEVERITY.optional(),
}).strict()

contentMemoryRoutes.post('/feedback', async (c) => {
  const body = FeedbackBody.parse(await c.req.json())
  const memory = getStack().experience.saveFeedback(body)
  return c.json({ ok: true, memory })
})

contentMemoryRoutes.post('/memories/:id/promote', (c) => {
  getStack().experience.promote(c.req.param('id'))
  return c.json({ ok: true })
})
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @anubis/content-memory build && pnpm vitest run packages/conversation/tests/content-memory-stack.test.ts`
Expected: PASS.

Run: `pnpm --filter @anubis/conversation typecheck && pnpm --filter @anubis/backend typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/conversation/src/index.ts packages/conversation/tests/content-memory-stack.test.ts packages/backend/src/content-memory.ts
git commit -m "feat(backend): experience feedback + promote routes; recall into context pack"
```

---

## Task 7: Full verification

- [ ] **Step 1: Build the chain**

Run: `pnpm --filter @anubis/content-memory build && pnpm --filter @anubis/conversation build && pnpm --filter @anubis/backend build`
Expected: all succeed.

- [ ] **Step 2: Run suites**

Run: `pnpm vitest run packages/content-memory && pnpm vitest run packages/conversation`
Expected: all green (vendor the model for the stack tests, or gate them).

- [ ] **Step 3: Repo-wide typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit (empty allowed)**

```bash
git add -A
git commit -m "test(content-memory): phase 4 experience index verified" --allow-empty
```

---

## Self-review

**Spec coverage (design §8 Phase 4 / original §9.4, §16.5, §19):**
- `experience_memories` with full lifecycle fields → Task 2.
- `recordCandidate` / `saveFeedback` (candidate creation) / `promote` (candidate→active) → Task 3 (original §16.5, §19.3).
- Active memories appear in future context packs → Task 4 (recall into `experienceMemory` + citations).
- Scoped + platform-filtered recall (no cross-workspace leakage) → Task 2 `recallActive` + test.
- HTTP feedback surface → Task 6.

**Deliberately deferred:** workflow `lessonWriter`/`lessonReader` nodes + the rejection→regenerate loop (need the durable engine; they will call `ExperienceIndexService`, which is the stable seam built here); `reinforce`/confidence-decay scoring (counters exist, policy later); validators (Phase 5).

**Type consistency:** `ExperienceMemory` shape identical across repo (Task 2), service (Task 3), exports (Task 5). `experience` is optional on `ContextPackDeps` so Phase 3's construction and tests remain valid. Migration versions `[8,9,11,12,13,14]` consistent across SQL filename, `CONTENT_MEMORY_MIGRATIONS`, and the index test.

**Placeholder scan:** none.

---

## Execution handoff

Phase 5 (Validators + agent-run wiring — `WorkspaceLeakageValidator`, `BrandRuleValidator`, `RepeatedMistakeValidator`, `PlatformRuleValidator`; `agent_runs` persistence; validate output before human review; feed approval/rejection back via `ExperienceIndexService.saveFeedback`) gets its own plan once Phase 4 lands.
