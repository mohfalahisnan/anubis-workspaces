# Scoped Content Memory — Phase 3 (Context Pack) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. **Prerequisite: Phases 1 & 2 merged.**

**Goal:** Assemble an AI-ready `ContentContextPack` for a brand+platform content task — brand context, platform context, separated approved/competitor/rejected similar content, global frameworks, workspace rules, and citations — served by a `ContentMemoryService` over HTTP, with knowledge documents upgraded to semantic (embedding) retrieval.

**Architecture:** Add an `embedding` column to `knowledge_documents` (semantic doc search behind a new `searchSemantic` method; Phase 1 lexical `search` stays). A `ContextPackService` composes the pack from `BrandWorkspacesRepo` + `KnowledgeDocumentsRepo` + `ContentSimilarityItemsRepo` + the `Embedder` (embed query once, reuse for both stores). `ContentMemoryService.buildForContentTask()` orchestrates + persists to `content_context_packs`. A Hono route `POST /content-memory/context-pack` exposes it via `getStack()`.

**Tech Stack:** TypeScript (ESM, NodeNext), better-sqlite3, Hono, Vitest.

**Reference:** design `2026-06-05-scoped-content-memory-design.md` (§4.4, §6, this implements §8 Phase 3); original spec §13 (context pack shape), §14 (sections), §15 (service).

---

## Scope of this phase

In scope (design §8 Phase 3):
- `knowledge_documents.embedding` (migration 012) + `KnowledgeIngestionService` + `searchSemantic`.
- `content_context_packs` (migration 013) + repo.
- `ContentContextPack` type + `ContextPackService.buildContentContextPack`.
- `ContentMemoryService.buildForContentTask` (orchestrate + persist) on `ConversationStack`.
- `POST /content-memory/context-pack` route.
- Tests: semantic doc search, approved/competitor/**rejected** bucket separation (spec §22.4), full pack assembly + citations.

Out of scope (later): `experienceMemory` section is left as **empty arrays** here (filled in Phase 4); validators (Phase 5); `agent_runs` (Phase 5); `knowledge_chunks` sub-document granularity (deferred — document-level embedding is the MVP; revisit if long docs need it); `campaignContext` (deferred). Frontend workflow nodes call the HTTP route — node wiring tracked separately.

**Migration bookkeeping:** content-memory owns 008/009/011 (Phases 1–2) and now **012, 013**. (010 is conversation's.) `CONTENT_MEMORY_MIGRATIONS` → `[8, 9, 11, 12, 13]`.

---

## File structure

New in `packages/content-memory/`:
```
src/db/migrations/012_knowledge_documents_embedding.sql
src/db/migrations/013_content_context_packs.sql
src/db/repositories/content-context-packs-repo.ts
src/knowledge/knowledge-ingestion-service.ts
src/context-pack/types.ts
src/context-pack/context-pack-service.ts
src/service.ts                                  # ContentMemoryService
tests/knowledge-ingestion-service.test.ts
tests/context-pack-service.test.ts
tests/content-memory-service.test.ts
```
Modified in `packages/content-memory/`:
```
src/db/repositories/knowledge-documents-repo.ts   # embedding column + searchSemantic
src/db/migrations/index.ts                         # + 012, 013
src/index.ts                                       # export pack + service API
tests/migrations-index.test.ts                     # expect [8,9,11,12,13]
```
New/modified in `packages/conversation/` + `packages/backend/`:
```
packages/conversation/src/index.ts                 # instantiate ContentMemoryService, expose
packages/backend/src/content-memory.ts             # NEW route
packages/backend/src/app.ts                        # register route
```

---

## Task 1: Add `embedding` to `knowledge_documents` + semantic search

**Files:**
- Create: `packages/content-memory/src/db/migrations/012_knowledge_documents_embedding.sql`
- Modify: `packages/content-memory/src/db/repositories/knowledge-documents-repo.ts`
- Test: `packages/content-memory/tests/knowledge-documents-repo.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `packages/content-memory/tests/knowledge-documents-repo.test.ts`:

```ts
import { Float32Array as _f } from 'node:buffer' // no-op import guard; remove if lint flags

describe('KnowledgeDocumentsRepo.searchSemantic', () => {
  it('ranks scoped docs by cosine to the query embedding', () => {
    const repo = setup()
    repo.insert(doc({ id: 'near', workspaceId: 'workspace-a', extractedText: 'hooks',
      embedding: Float32Array.from([1, 0, 0, 0]) }))
    repo.insert(doc({ id: 'far', workspaceId: 'workspace-a', extractedText: 'hooks',
      embedding: Float32Array.from([0, 1, 0, 0]) }))
    repo.insert(doc({ id: 'other-ws', workspaceId: 'workspace-b', extractedText: 'hooks',
      embedding: Float32Array.from([1, 0, 0, 0]) }))

    const results = repo.searchSemantic({
      workspaceId: 'workspace-a', platform: 'instagram',
      queryEmbedding: Float32Array.from([1, 0, 0, 0]),
    })

    expect(results.map((r) => r.id)).toEqual(['near', 'far'])
    expect(results.every((r) => r.scope === 'global' || r.workspaceId === 'workspace-a')).toBe(true)
  })

  it('ignores documents without an embedding', () => {
    const repo = setup()
    repo.insert(doc({ id: 'no-emb', workspaceId: 'workspace-a' })) // embedding undefined
    const results = repo.searchSemantic({
      workspaceId: 'workspace-a', platform: 'instagram',
      queryEmbedding: Float32Array.from([1, 0, 0, 0]),
    })
    expect(results).toHaveLength(0)
  })
})
```

Update the existing `doc()` helper in this file to accept an optional embedding — replace its return object's start to include `embedding`:

```ts
function doc(over: Partial<NewKnowledgeDocument>): NewKnowledgeDocument {
  return {
    id: over.id ?? `d-${Math.random().toString(36).slice(2)}`,
    embedding: over.embedding,
    scope: over.scope ?? 'workspace',
    // …rest unchanged…
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
```

Also update this test file's migration list to include 012:

```ts
const migrations = [
  { version: 8, sql: sqlFor('008_brand_workspaces.sql') },
  { version: 9, sql: sqlFor('009_knowledge_documents.sql') },
  { version: 12, sql: sqlFor('012_knowledge_documents_embedding.sql') },
]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/content-memory/tests/knowledge-documents-repo.test.ts`
Expected: FAIL — `searchSemantic` undefined / migration 012 missing.

- [ ] **Step 3: Create the migration**

Create `packages/content-memory/src/db/migrations/012_knowledge_documents_embedding.sql`:

```sql
-- Document-level embedding for semantic retrieval (nullable; lexical search still works without it).
ALTER TABLE knowledge_documents ADD COLUMN embedding BLOB;
```

- [ ] **Step 4: Update the repo (embedding column + searchSemantic)**

In `packages/content-memory/src/db/repositories/knowledge-documents-repo.ts`:

Add the import at the top:

```ts
import { cosine, fromBlob, toBlob } from '../../embedding/vector.js'
```

Add `embedding?: Float32Array` to `KnowledgeDocument` (after `entities: string[]`):

```ts
  embedding?: Float32Array
```

Add `embedding: Buffer | null` to the `Row` interface (after `entities: string`):

```ts
  embedding: Buffer | null
```

In `toDoc`, add (after `entities: parseArr(r.entities),`):

```ts
    embedding: r.embedding ? fromBlob(r.embedding) : undefined,
```

In `insert`, add the column + value + param. The SQL column list gains `embedding`, the VALUES gains `@embedding`, and the params object gains:

```ts
      embedding: d.embedding ? toBlob(d.embedding) : null,
```

(So the full insert columns become `…, entities, embedding, status, content_hash, …` and VALUES `…, @entities, @embedding, @status, @contentHash, …`.)

Add the new search input type + method. After `SearchKnowledgeInput`:

```ts
export interface SemanticSearchKnowledgeInput {
  workspaceId: string
  platform: Platform
  queryEmbedding: Float32Array
  includeGlobal?: boolean
  sourceTypes?: import('../../types.js').SourceType[]
  limit?: number
}
```

Add the method to the class (after `search`):

```ts
  /** Semantic search: scope+platform filtered in SQL, cosine-ranked in JS. */
  searchSemantic(input: SemanticSearchKnowledgeInput): ScoredDocument[] {
    const includeGlobal = input.includeGlobal ?? true
    const where: string[] = [
      "status = 'active'",
      'embedding IS NOT NULL',
      '(workspace_id = @workspaceId OR (@includeGlobal = 1 AND scope = \'global\'))',
      "(platform IS NULL OR platform = @platform OR platform = 'general')",
    ]
    const params: Record<string, unknown> = {
      workspaceId: input.workspaceId,
      includeGlobal: includeGlobal ? 1 : 0,
      platform: input.platform,
    }
    if (input.sourceTypes?.length) {
      where.push(`source_type IN (${input.sourceTypes.map((_, i) => `@st${i}`).join(', ')})`)
      input.sourceTypes.forEach((st, i) => { params[`st${i}`] = st })
    }
    const rows = this.db
      .prepare(`SELECT * FROM knowledge_documents WHERE ${where.join(' AND ')}`)
      .all(params) as Row[]
    const scored = rows
      .map(toDoc)
      .map((d) => ({ ...d, score: d.embedding ? cosine(d.embedding, input.queryEmbedding) : 0 }))
      .sort((a, b) => b.score - a.score || b.createdAt - a.createdAt)
    return typeof input.limit === 'number' ? scored.slice(0, input.limit) : scored
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/content-memory/tests/knowledge-documents-repo.test.ts`
Expected: PASS (Phase 1 tests + 2 new semantic tests).

- [ ] **Step 6: Commit**

```bash
git add packages/content-memory/src/db/migrations/012_knowledge_documents_embedding.sql packages/content-memory/src/db/repositories/knowledge-documents-repo.ts packages/content-memory/tests/knowledge-documents-repo.test.ts
git commit -m "feat(content-memory): document embeddings + semantic knowledge search"
```

---

## Task 2: `KnowledgeIngestionService` (embed + store documents)

**Files:**
- Create: `packages/content-memory/src/knowledge/knowledge-ingestion-service.ts`
- Test: `packages/content-memory/tests/knowledge-ingestion-service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/content-memory/tests/knowledge-ingestion-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { freshDb } from './helpers/db.js'
import { FakeEmbedder } from './helpers/fake-embedder.js'
import { BrandWorkspacesRepo } from '../src/db/repositories/brand-workspaces-repo.js'
import { KnowledgeDocumentsRepo } from '../src/db/repositories/knowledge-documents-repo.js'
import { KnowledgeIngestionService } from '../src/knowledge/knowledge-ingestion-service.js'

const here = dirname(fileURLToPath(import.meta.url))
const sqlFor = (f: string) => readFileSync(join(here, '../src/db/migrations', f), 'utf8')
const migrations = [
  { version: 8, sql: sqlFor('008_brand_workspaces.sql') },
  { version: 9, sql: sqlFor('009_knowledge_documents.sql') },
  { version: 12, sql: sqlFor('012_knowledge_documents_embedding.sql') },
]

function setup() {
  const db = freshDb(migrations)
  new BrandWorkspacesRepo(db).insert({
    id: 'workspace-a', name: 'A', brandSummary: null,
    toneOfVoice: [], audience: [], offers: [], constraints: [],
    status: 'active', createdAt: 100, updatedAt: 100,
  })
  const docs = new KnowledgeDocumentsRepo(db)
  const svc = new KnowledgeIngestionService(docs, new FakeEmbedder())
  return { docs, svc }
}

describe('KnowledgeIngestionService', () => {
  it('embeds and stores a workspace document, retrievable semantically', async () => {
    const { svc, docs } = setup()
    await svc.ingest({
      scope: 'workspace', workspaceId: 'workspace-a', platform: 'instagram',
      sourceType: 'brand_guideline', title: 'Tone', text: 'warm and educational',
    })
    const q = await new FakeEmbedder().embed('warm and educational')
    const results = docs.searchSemantic({
      workspaceId: 'workspace-a', platform: 'instagram', queryEmbedding: q,
    })
    expect(results).toHaveLength(1)
    expect(results[0]!.title).toBe('Tone')
    expect(results[0]!.score).toBeCloseTo(1, 6)
  })

  it('stores a global document with null workspaceId', async () => {
    const { svc, docs } = setup()
    await svc.ingest({
      scope: 'global', platform: 'instagram',
      sourceType: 'global_framework', title: 'Hook framework', text: 'open with a question',
    })
    const q = await new FakeEmbedder().embed('open with a question')
    const results = docs.searchSemantic({
      workspaceId: 'workspace-a', platform: 'instagram', queryEmbedding: q,
    })
    expect(results.some((r) => r.scope === 'global')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/content-memory/tests/knowledge-ingestion-service.test.ts`
Expected: FAIL — service not found.

- [ ] **Step 3: Create the service**

Create `packages/content-memory/src/knowledge/knowledge-ingestion-service.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import type { Platform, Scope, SourceType } from '../types.js'
import type { Embedder } from '../embedding/embedder.js'
import type { KnowledgeDocumentsRepo, KnowledgeDocument } from '../db/repositories/knowledge-documents-repo.js'

export interface IngestKnowledgeInput {
  scope: Scope
  workspaceId?: string | null
  platform?: Platform | null
  sourceType: SourceType
  title: string
  text: string
  summary?: string | null
  tags?: string[]
  topics?: string[]
  entities?: string[]
}

export class KnowledgeIngestionService {
  constructor(
    private docs: KnowledgeDocumentsRepo,
    private embedder: Embedder,
  ) {}

  async ingest(input: IngestKnowledgeInput, now: number = Date.now()): Promise<KnowledgeDocument> {
    const embedding = await this.embedder.embed(`${input.title}\n${input.text}`)
    const doc: KnowledgeDocument = {
      id: randomUUID(),
      scope: input.scope,
      workspaceId: input.scope === 'global' ? null : (input.workspaceId ?? null),
      platform: input.platform ?? null,
      sourceType: input.sourceType,
      title: input.title,
      extractedText: input.text,
      summary: input.summary ?? null,
      tags: input.tags ?? [],
      topics: input.topics ?? [],
      entities: input.entities ?? [],
      embedding,
      status: 'active',
      contentHash: createHash('sha256').update(`${input.title}\n${input.text}`).digest('hex'),
      createdAt: now,
      updatedAt: now,
    }
    this.docs.insert(doc)
    return doc
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/content-memory/tests/knowledge-ingestion-service.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/content-memory/src/knowledge/knowledge-ingestion-service.ts packages/content-memory/tests/knowledge-ingestion-service.test.ts
git commit -m "feat(content-memory): KnowledgeIngestionService"
```

---

## Task 3: `content_context_packs` table + repo

**Files:**
- Create: `packages/content-memory/src/db/migrations/013_content_context_packs.sql`
- Create: `packages/content-memory/src/db/repositories/content-context-packs-repo.ts`
- Test: `packages/content-memory/tests/content-context-packs-repo.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/content-memory/tests/content-context-packs-repo.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { freshDb } from './helpers/db.js'
import { BrandWorkspacesRepo } from '../src/db/repositories/brand-workspaces-repo.js'
import { ContentContextPacksRepo } from '../src/db/repositories/content-context-packs-repo.js'

const here = dirname(fileURLToPath(import.meta.url))
const sqlFor = (f: string) => readFileSync(join(here, '../src/db/migrations', f), 'utf8')
const migrations = [
  { version: 8, sql: sqlFor('008_brand_workspaces.sql') },
  { version: 13, sql: sqlFor('013_content_context_packs.sql') },
]

function setup() {
  const db = freshDb(migrations)
  new BrandWorkspacesRepo(db).insert({
    id: 'workspace-a', name: 'A', brandSummary: null,
    toneOfVoice: [], audience: [], offers: [], constraints: [],
    status: 'active', createdAt: 100, updatedAt: 100,
  })
  return new ContentContextPacksRepo(db)
}

describe('ContentContextPacksRepo', () => {
  it('saves and reads a pack record with its JSON payload', () => {
    const repo = setup()
    repo.save({
      id: 'pack-1', workspaceId: 'workspace-a', platform: 'instagram',
      campaignId: null, taskType: 'generate_content',
      objective: 'post', query: 'skincare',
      contextJson: { hello: 'world' }, tokenCount: 42, createdAt: 100,
    })
    const got = repo.findById('pack-1')
    expect(got?.tokenCount).toBe(42)
    expect((got?.contextJson as { hello: string }).hello).toBe('world')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/content-memory/tests/content-context-packs-repo.test.ts`
Expected: FAIL — migration / repo missing.

- [ ] **Step 3: Create the migration**

Create `packages/content-memory/src/db/migrations/013_content_context_packs.sql`:

```sql
CREATE TABLE content_context_packs (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES brand_workspaces(id),
  platform     TEXT NOT NULL,
  campaign_id  TEXT,
  task_type    TEXT NOT NULL,
  objective    TEXT NOT NULL,
  query        TEXT NOT NULL,
  context_json TEXT NOT NULL,   -- serialized ContentContextPack
  token_count  INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_context_packs_workspace
  ON content_context_packs(workspace_id, created_at DESC);
```

- [ ] **Step 4: Create the repo**

Create `packages/content-memory/src/db/repositories/content-context-packs-repo.ts`:

```ts
import type { Db } from '../types.js'

export interface ContentContextPackRecord {
  id: string
  workspaceId: string
  platform: string
  campaignId: string | null
  taskType: string
  objective: string
  query: string
  contextJson: unknown
  tokenCount: number
  createdAt: number
}

interface Row {
  id: string
  workspace_id: string
  platform: string
  campaign_id: string | null
  task_type: string
  objective: string
  query: string
  context_json: string
  token_count: number
  created_at: number
}

function toRecord(r: Row): ContentContextPackRecord {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    platform: r.platform,
    campaignId: r.campaign_id,
    taskType: r.task_type,
    objective: r.objective,
    query: r.query,
    contextJson: JSON.parse(r.context_json),
    tokenCount: r.token_count,
    createdAt: r.created_at,
  }
}

export class ContentContextPacksRepo {
  constructor(private db: Db) {}

  save(rec: ContentContextPackRecord): void {
    this.db.prepare(`
      INSERT INTO content_context_packs (
        id, workspace_id, platform, campaign_id, task_type, objective, query,
        context_json, token_count, created_at
      ) VALUES (
        @id, @workspaceId, @platform, @campaignId, @taskType, @objective, @query,
        @contextJson, @tokenCount, @createdAt
      )
    `).run({
      id: rec.id,
      workspaceId: rec.workspaceId,
      platform: rec.platform,
      campaignId: rec.campaignId ?? null,
      taskType: rec.taskType,
      objective: rec.objective,
      query: rec.query,
      contextJson: JSON.stringify(rec.contextJson),
      tokenCount: rec.tokenCount,
      createdAt: rec.createdAt,
    })
  }

  findById(id: string): ContentContextPackRecord | null {
    const r = this.db
      .prepare('SELECT * FROM content_context_packs WHERE id = ?')
      .get(id) as Row | undefined
    return r ? toRecord(r) : null
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/content-memory/tests/content-context-packs-repo.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/content-memory/src/db/migrations/013_content_context_packs.sql packages/content-memory/src/db/repositories/content-context-packs-repo.ts packages/content-memory/tests/content-context-packs-repo.test.ts
git commit -m "feat(content-memory): content_context_packs store"
```

---

## Task 4: `ContentContextPack` types

**Files:**
- Create: `packages/content-memory/src/context-pack/types.ts`
- Test: covered by Task 5 (types have no runtime behavior).

- [ ] **Step 1: Create the types**

Create `packages/content-memory/src/context-pack/types.ts`:

```ts
import type { ApprovalStatus, ContentType, Platform } from '../types.js'

export type ContentTaskType =
  | 'analyze_competitor' | 'build_brief' | 'generate_content'
  | 'rewrite_content' | 'review_content' | 'create_calendar'

export interface SimilarContent {
  id: string
  contentType: ContentType
  platform: Platform
  text: string
  reason: string
  performanceScore?: number
  engagementScore?: number
  brandFitScore?: number
  approvalStatus?: ApprovalStatus
  rejectionReason?: string
}

export interface Citation {
  sourceId: string
  sourceType: 'knowledge_document' | 'similarity_item' | 'experience_memory'
  title: string
  excerpt: string
}

export interface ContentContextPack {
  workspaceId: string
  platform: Platform
  taskType: ContentTaskType
  objective: string
  brandContext: {
    brandSummary: string
    toneOfVoice: string[]
    audience: string[]
    offers: string[]
    constraints: string[]
  }
  platformContext: {
    platform: Platform
    formatRules: string[]
    contentPatterns: string[]
    algorithmNotes: string[]
  }
  similarContent: {
    approved: SimilarContent[]
    competitor: SimilarContent[]
    rejected: SimilarContent[]
  }
  globalFrameworks: {
    hooks: string[]
    copywritingPatterns: string[]
    contentStructures: string[]
    ctaPatterns: string[]
  }
  workspaceRules: {
    mustFollow: string[]
    mustAvoid: string[]
    clientPreferences: string[]
  }
  experienceMemory: {
    previousMistakes: string[]
    reviewerFeedback: string[]
    validationRules: string[]
  }
  citations: Citation[]
  finalInstruction: string
}

export interface BuildContentContextInput {
  workspaceId: string
  platform: Platform
  taskType: ContentTaskType
  query: string
  objective: string
  campaignId?: string
  limitPerBucket?: number
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @anubis/content-memory typecheck`
Expected: no errors (these are pure types; consumed in Task 5).

- [ ] **Step 3: Commit**

```bash
git add packages/content-memory/src/context-pack/types.ts
git commit -m "feat(content-memory): ContentContextPack types"
```

---

## Task 5: `ContextPackService` (assembly with separated buckets)

**Files:**
- Create: `packages/content-memory/src/context-pack/context-pack-service.ts`
- Test: `packages/content-memory/tests/context-pack-service.test.ts`

This is the heart of Phase 3 and where the **rejected-content routing** (design §6.2, spec §22.4) is enforced: approved/competitor/rejected are fetched as *separate* similarity queries and placed in distinct buckets.

- [ ] **Step 1: Write the failing test**

Create `packages/content-memory/tests/context-pack-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { freshDb } from './helpers/db.js'
import { FakeEmbedder } from './helpers/fake-embedder.js'
import { BrandWorkspacesRepo } from '../src/db/repositories/brand-workspaces-repo.js'
import { KnowledgeDocumentsRepo } from '../src/db/repositories/knowledge-documents-repo.js'
import { ContentSimilarityItemsRepo } from '../src/db/repositories/content-similarity-items-repo.js'
import { SimilarityIngestionService } from '../src/similarity/similarity-ingestion-service.js'
import { ContextPackService } from '../src/context-pack/context-pack-service.js'

const here = dirname(fileURLToPath(import.meta.url))
const sqlFor = (f: string) => readFileSync(join(here, '../src/db/migrations', f), 'utf8')
const migrations = [
  { version: 8, sql: sqlFor('008_brand_workspaces.sql') },
  { version: 9, sql: sqlFor('009_knowledge_documents.sql') },
  { version: 11, sql: sqlFor('011_content_similarity_items.sql') },
  { version: 12, sql: sqlFor('012_knowledge_documents_embedding.sql') },
]

async function setup() {
  const db = freshDb(migrations)
  const brands = new BrandWorkspacesRepo(db)
  brands.insert({
    id: 'workspace-a', name: 'Skincare A', brandSummary: 'Gentle skincare',
    toneOfVoice: ['warm'], audience: ['women 25-40'], offers: ['serum'],
    constraints: ['no fear-based hooks'],
    status: 'active', createdAt: 100, updatedAt: 100,
  })
  const docs = new KnowledgeDocumentsRepo(db)
  const items = new ContentSimilarityItemsRepo(db)
  const embedder = new FakeEmbedder()
  const ingest = new SimilarityIngestionService(items, embedder)
  await ingest.ingest({ workspaceId: 'workspace-a', platform: 'instagram',
    contentId: 'a1', contentType: 'approved_post', caption: 'skincare win', approvalStatus: 'approved' })
  await ingest.ingest({ workspaceId: 'workspace-a', platform: 'instagram',
    contentId: 'c1', contentType: 'competitor_post', caption: 'competitor skincare' })
  await ingest.ingest({ workspaceId: 'workspace-a', platform: 'instagram',
    contentId: 'r1', contentType: 'rejected_post', caption: 'fear-based skincare',
    approvalStatus: 'rejected', rejectionReason: 'used a fear hook' })
  return new ContextPackService({ brands, docs, items, embedder })
}

describe('ContextPackService.buildContentContextPack', () => {
  it('fills brand context from the brand workspace', async () => {
    const svc = await setup()
    const pack = await svc.buildContentContextPack({
      workspaceId: 'workspace-a', platform: 'instagram',
      taskType: 'generate_content', query: 'skincare campaign', objective: 'Generate post',
    })
    expect(pack.brandContext.brandSummary).toBe('Gentle skincare')
    expect(pack.brandContext.constraints).toContain('no fear-based hooks')
    expect(pack.workspaceRules.mustAvoid).toContain('no fear-based hooks')
  })

  it('separates approved, competitor and rejected similar content (spec §22.4)', async () => {
    const svc = await setup()
    const pack = await svc.buildContentContextPack({
      workspaceId: 'workspace-a', platform: 'instagram',
      taskType: 'generate_content', query: 'skincare', objective: 'Generate post',
    })
    expect(pack.similarContent.approved.map((s) => s.id)).toContain('a1')
    expect(pack.similarContent.competitor.map((s) => s.id)).toContain('c1')
    expect(pack.similarContent.rejected.map((s) => s.id)).toContain('r1')
    // Rejected never leaks into approved.
    expect(pack.similarContent.approved.some((s) => s.approvalStatus === 'rejected')).toBe(false)
    expect(pack.similarContent.approved.map((s) => s.id)).not.toContain('r1')
  })

  it('emits citations and a final instruction', async () => {
    const svc = await setup()
    const pack = await svc.buildContentContextPack({
      workspaceId: 'workspace-a', platform: 'instagram',
      taskType: 'generate_content', query: 'skincare', objective: 'Generate post',
    })
    expect(pack.citations.length).toBeGreaterThan(0)
    expect(pack.finalInstruction).toContain('Generate post')
  })

  it('throws for an unknown workspace', async () => {
    const svc = await setup()
    await expect(svc.buildContentContextPack({
      workspaceId: 'nope', platform: 'instagram',
      taskType: 'generate_content', query: 'x', objective: 'y',
    })).rejects.toThrow(/workspace/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/content-memory/tests/context-pack-service.test.ts`
Expected: FAIL — service not found.

- [ ] **Step 3: Create the service**

Create `packages/content-memory/src/context-pack/context-pack-service.ts`:

```ts
import type { Embedder } from '../embedding/embedder.js'
import type { BrandWorkspacesRepo } from '../db/repositories/brand-workspaces-repo.js'
import type { KnowledgeDocumentsRepo, ScoredDocument } from '../db/repositories/knowledge-documents-repo.js'
import type {
  ContentSimilarityItemsRepo,
  ScoredSimilarityItem,
} from '../db/repositories/content-similarity-items-repo.js'
import type {
  BuildContentContextInput,
  Citation,
  ContentContextPack,
  SimilarContent,
} from './types.js'

export interface ContextPackDeps {
  brands: BrandWorkspacesRepo
  docs: KnowledgeDocumentsRepo
  items: ContentSimilarityItemsRepo
  embedder: Embedder
}

function toSimilar(it: ScoredSimilarityItem): SimilarContent {
  return {
    id: it.id,
    contentType: it.contentType,
    platform: it.platform,
    text: it.normalizedText,
    reason: `cosine ${it.score.toFixed(3)}`,
    performanceScore: it.performanceScore ?? undefined,
    engagementScore: it.engagementScore ?? undefined,
    brandFitScore: it.brandFitScore ?? undefined,
    approvalStatus: it.approvalStatus ?? undefined,
    rejectionReason: it.rejectionReason ?? undefined,
  }
}

export class ContextPackService {
  constructor(private deps: ContextPackDeps) {}

  async buildContentContextPack(input: BuildContentContextInput): Promise<ContentContextPack> {
    const brand = this.deps.brands.findById(input.workspaceId)
    if (!brand) throw new Error(`Unknown brand workspace: ${input.workspaceId}`)

    const limit = input.limitPerBucket ?? 3
    const q = await this.deps.embedder.embed(`${input.objective}\n${input.query}`)
    const citations: Citation[] = []

    // --- Similar content: three SEPARATE queries → three distinct buckets ---
    const approved = this.deps.items.search({
      workspaceId: input.workspaceId, platform: input.platform, queryEmbedding: q,
      contentTypes: ['approved_post', 'own_post'], limit,
    })
    const competitor = this.deps.items.search({
      workspaceId: input.workspaceId, platform: input.platform, queryEmbedding: q,
      contentTypes: ['competitor_post'], limit,
    })
    const rejected = this.deps.items.search({
      workspaceId: input.workspaceId, platform: input.platform, queryEmbedding: q,
      contentTypes: ['rejected_post'], limit,
    })
    for (const it of [...approved, ...competitor, ...rejected]) {
      citations.push({
        sourceId: it.id, sourceType: 'similarity_item',
        title: it.contentType, excerpt: it.normalizedText.slice(0, 160),
      })
    }

    // --- Knowledge: global frameworks + platform rules + workspace guidelines ---
    const frameworks = this.deps.docs.searchSemantic({
      workspaceId: input.workspaceId, platform: input.platform, queryEmbedding: q,
      sourceTypes: ['global_framework'], limit: 5,
    })
    const platformRules = this.deps.docs.searchSemantic({
      workspaceId: input.workspaceId, platform: input.platform, queryEmbedding: q,
      sourceTypes: ['platform_rule'], limit: 5,
    })
    const guidelines = this.deps.docs.searchSemantic({
      workspaceId: input.workspaceId, platform: input.platform, queryEmbedding: q,
      sourceTypes: ['brand_guideline', 'sop'], includeGlobal: false, limit: 5,
    })
    const cite = (d: ScoredDocument) => citations.push({
      sourceId: d.id, sourceType: 'knowledge_document',
      title: d.title, excerpt: (d.summary ?? d.extractedText).slice(0, 160),
    })
    frameworks.forEach(cite); platformRules.forEach(cite); guidelines.forEach(cite)

    const summarize = (d: ScoredDocument) => d.summary ?? d.title

    const pack: ContentContextPack = {
      workspaceId: input.workspaceId,
      platform: input.platform,
      taskType: input.taskType,
      objective: input.objective,
      brandContext: {
        brandSummary: brand.brandSummary ?? '',
        toneOfVoice: brand.toneOfVoice,
        audience: brand.audience,
        offers: brand.offers,
        constraints: brand.constraints,
      },
      platformContext: {
        platform: input.platform,
        formatRules: platformRules.map(summarize),
        contentPatterns: [],
        algorithmNotes: [],
      },
      similarContent: {
        approved: approved.map(toSimilar),
        competitor: competitor.map(toSimilar),
        rejected: rejected.map(toSimilar),
      },
      globalFrameworks: {
        hooks: [],
        copywritingPatterns: frameworks.map(summarize),
        contentStructures: [],
        ctaPatterns: [],
      },
      workspaceRules: {
        mustFollow: guidelines.map(summarize),
        mustAvoid: brand.constraints,
        clientPreferences: [],
      },
      experienceMemory: {
        previousMistakes: [],   // populated in Phase 4
        reviewerFeedback: [],
        validationRules: [],
      },
      citations,
      finalInstruction: this.finalInstruction(input, brand.constraints),
    }
    return pack
  }

  private finalInstruction(input: BuildContentContextInput, constraints: string[]): string {
    const avoid = constraints.length ? ` Must avoid: ${constraints.join('; ')}.` : ''
    return `${input.objective} for platform "${input.platform}". ` +
      `Use the approved examples as positive references and the rejected examples ` +
      `strictly as patterns to avoid.${avoid}`
  }
}
```

Note: `globalFrameworks.hooks/contentStructures/ctaPatterns` and
`platformContext.contentPatterns/algorithmNotes` are intentionally left empty for
the MVP — populated when a framework taxonomy exists. `copywritingPatterns` /
`formatRules` carry the retrieved framework / platform-rule summaries.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/content-memory/tests/context-pack-service.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/content-memory/src/context-pack/context-pack-service.ts packages/content-memory/tests/context-pack-service.test.ts
git commit -m "feat(content-memory): ContextPackService with separated approved/rejected buckets"
```

---

## Task 6: `ContentMemoryService` (orchestrate + persist) + exports

**Files:**
- Create: `packages/content-memory/src/service.ts`
- Modify: `packages/content-memory/src/db/migrations/index.ts` (+ 012, 013)
- Modify: `packages/content-memory/src/index.ts`
- Modify: `packages/content-memory/tests/migrations-index.test.ts`
- Test: `packages/content-memory/tests/content-memory-service.test.ts`

- [ ] **Step 1: Update the migrations-index test (expect 12, 13)**

Replace the assertion in `packages/content-memory/tests/migrations-index.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { CONTENT_MEMORY_MIGRATIONS } from '../src/db/migrations/index.js'

describe('CONTENT_MEMORY_MIGRATIONS', () => {
  it('exports versions 8, 9, 11, 12, 13 with non-empty SQL', () => {
    const versions = CONTENT_MEMORY_MIGRATIONS.map((m) => m.version)
    expect(versions).toEqual([8, 9, 11, 12, 13])
    for (const m of CONTENT_MEMORY_MIGRATIONS) {
      expect(m.sql.length).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 2: Register migrations 012 + 013**

In `packages/content-memory/src/db/migrations/index.ts`, extend the array:

```ts
export const CONTENT_MEMORY_MIGRATIONS: Migration[] = [
  load(8, '008_brand_workspaces.sql'),
  load(9, '009_knowledge_documents.sql'),
  // 10 is owned by @anubis/conversation (competitors ALTER).
  load(11, '011_content_similarity_items.sql'),
  load(12, '012_knowledge_documents_embedding.sql'),
  load(13, '013_content_context_packs.sql'),
]
```

- [ ] **Step 3: Write the failing service test**

Create `packages/content-memory/tests/content-memory-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { freshDb } from './helpers/db.js'
import { FakeEmbedder } from './helpers/fake-embedder.js'
import { BrandWorkspacesRepo } from '../src/db/repositories/brand-workspaces-repo.js'
import { KnowledgeDocumentsRepo } from '../src/db/repositories/knowledge-documents-repo.js'
import { ContentSimilarityItemsRepo } from '../src/db/repositories/content-similarity-items-repo.js'
import { ContentContextPacksRepo } from '../src/db/repositories/content-context-packs-repo.js'
import { ContextPackService } from '../src/context-pack/context-pack-service.js'
import { ContentMemoryService } from '../src/service.js'

const here = dirname(fileURLToPath(import.meta.url))
const sqlFor = (f: string) => readFileSync(join(here, '../src/db/migrations', f), 'utf8')
const migrations = [8, 9, 11, 12, 13].map((v) => ({
  version: v,
  sql: sqlFor(
    { 8: '008_brand_workspaces.sql', 9: '009_knowledge_documents.sql',
      11: '011_content_similarity_items.sql', 12: '012_knowledge_documents_embedding.sql',
      13: '013_content_context_packs.sql' }[v as 8 | 9 | 11 | 12 | 13],
  ),
}))

function setup() {
  const db = freshDb(migrations)
  const brands = new BrandWorkspacesRepo(db)
  brands.insert({
    id: 'workspace-a', name: 'A', brandSummary: 'B',
    toneOfVoice: [], audience: [], offers: [], constraints: [],
    status: 'active', createdAt: 100, updatedAt: 100,
  })
  const embedder = new FakeEmbedder()
  const contextPack = new ContextPackService({
    brands, docs: new KnowledgeDocumentsRepo(db),
    items: new ContentSimilarityItemsRepo(db), embedder,
  })
  const packs = new ContentContextPacksRepo(db)
  return { svc: new ContentMemoryService({ contextPack, packs }), packs }
}

describe('ContentMemoryService.buildForContentTask', () => {
  it('builds a pack and persists a record', async () => {
    const { svc, packs } = setup()
    const { pack, packId } = await svc.buildForContentTask({
      workspaceId: 'workspace-a', platform: 'instagram',
      taskType: 'generate_content', query: 'skincare', objective: 'Generate',
    })
    expect(pack.workspaceId).toBe('workspace-a')
    expect(packs.findById(packId)?.taskType).toBe('generate_content')
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm vitest run packages/content-memory/tests/content-memory-service.test.ts`
Expected: FAIL — service not found.

- [ ] **Step 5: Create the service**

Create `packages/content-memory/src/service.ts`:

```ts
import { randomUUID } from 'node:crypto'
import type { ContentContextPacksRepo } from './db/repositories/content-context-packs-repo.js'
import type { ContextPackService } from './context-pack/context-pack-service.js'
import type { BuildContentContextInput, ContentContextPack } from './context-pack/types.js'

export interface ContentMemoryDeps {
  contextPack: ContextPackService
  packs: ContentContextPacksRepo
}

export interface BuildForContentTaskResult {
  packId: string
  pack: ContentContextPack
}

/** Rough token estimate: ~4 chars/token over the serialized pack. */
function estimateTokens(pack: ContentContextPack): number {
  return Math.ceil(JSON.stringify(pack).length / 4)
}

export class ContentMemoryService {
  constructor(private deps: ContentMemoryDeps) {}

  async buildForContentTask(
    input: BuildContentContextInput,
    now: number = Date.now(),
  ): Promise<BuildForContentTaskResult> {
    const pack = await this.deps.contextPack.buildContentContextPack(input)
    const packId = randomUUID()
    this.deps.packs.save({
      id: packId,
      workspaceId: input.workspaceId,
      platform: input.platform,
      campaignId: input.campaignId ?? null,
      taskType: input.taskType,
      objective: input.objective,
      query: input.query,
      contextJson: pack,
      tokenCount: estimateTokens(pack),
      createdAt: now,
    })
    return { packId, pack }
  }
}
```

- [ ] **Step 6: Add public exports**

Append to `packages/content-memory/src/index.ts`:

```ts
export type {
  IngestKnowledgeInput,
} from './knowledge/knowledge-ingestion-service.js'
export { KnowledgeIngestionService } from './knowledge/knowledge-ingestion-service.js'

export type {
  SemanticSearchKnowledgeInput,
} from './db/repositories/knowledge-documents-repo.js'

export type { ContentContextPackRecord } from './db/repositories/content-context-packs-repo.js'
export { ContentContextPacksRepo } from './db/repositories/content-context-packs-repo.js'

export type {
  ContentContextPack,
  ContentTaskType,
  SimilarContent,
  Citation,
  BuildContentContextInput,
} from './context-pack/types.js'
export type { ContextPackDeps } from './context-pack/context-pack-service.js'
export { ContextPackService } from './context-pack/context-pack-service.js'

export type { ContentMemoryDeps, BuildForContentTaskResult } from './service.js'
export { ContentMemoryService } from './service.js'
```

- [ ] **Step 7: Run tests + typecheck + build**

Run: `pnpm vitest run packages/content-memory`
Expected: all pass.

Run: `pnpm --filter @anubis/content-memory typecheck && pnpm --filter @anubis/content-memory build`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/content-memory/src/service.ts packages/content-memory/src/db/migrations/index.ts packages/content-memory/src/index.ts packages/content-memory/tests/migrations-index.test.ts packages/content-memory/tests/content-memory-service.test.ts
git commit -m "feat(content-memory): ContentMemoryService.buildForContentTask + exports"
```

---

## Task 7: Wire `ContentMemoryService` into the stack + HTTP route

**Files:**
- Modify: `packages/conversation/src/index.ts`
- Create: `packages/backend/src/content-memory.ts`
- Modify: `packages/backend/src/app.ts`
- Test: `packages/conversation/tests/content-memory-stack.test.ts`

- [ ] **Step 1: Write the failing stack test**

Create `packages/conversation/tests/content-memory-stack.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getBuiltinSkillRoots } from '@anubis/ai-agent'
import { createConversationService, type ConversationStack } from '../src/index.js'

let stack: ConversationStack | null = null
let dir: string | null = null

afterEach(async () => {
  if (stack) { await stack.shutdown(); stack = null }
  if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null }
})

describe('content-memory wired onto the stack', () => {
  it('exposes contentMemory and builds a pack for the default workspace', async () => {
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
    const { pack, packId } = await stack.contentMemory.buildForContentTask({
      workspaceId: 'default-workspace', platform: 'instagram',
      taskType: 'generate_content', query: 'test', objective: 'Generate',
    })
    expect(pack.workspaceId).toBe('default-workspace')
    expect(typeof packId).toBe('string')
  })
})
```

Note: this exercises the real `XenovaEmbedder`. The model must be vendored
(`pnpm --filter @anubis/content-memory exec node ./scripts/fetch-model.mjs`) for
this test to run offline; otherwise gate it like the smoke test. Keep it focused
on wiring, not ranking.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/conversation/tests/content-memory-stack.test.ts`
Expected: FAIL — `stack.contentMemory` undefined.

- [ ] **Step 3: Wire the service onto `ConversationStack`**

In `packages/conversation/src/index.ts`:

Extend the `@anubis/content-memory` import with the Phase 3 symbols:

```ts
import {
  BrandWorkspacesRepo,
  BrandWorkspacesService,
  ContentContextPacksRepo,
  ContentMemoryService,
  ContentSimilarityItemsRepo,
  ContextPackService,
  KnowledgeDocumentsRepo,
  SimilarityIngestionService,
  XenovaEmbedder,
  bundledModelCacheDir,
} from '@anubis/content-memory'
```

Add to the `ConversationStack` interface (after `capturedPostsSimilarity`):

```ts
  contentMemory: ContentMemoryService
```

In `createConversationService`, after the Phase 2 `contentEmbedder` /
`similarityItems` block, build the context-pack + memory services:

```ts
  const contextPack = new ContextPackService({
    brands: new BrandWorkspacesRepo(db),
    docs: knowledgeDocuments,
    items: similarityItems,
    embedder: contentEmbedder,
  })
  const contentMemory = new ContentMemoryService({
    contextPack,
    packs: new ContentContextPacksRepo(db),
  })
```

Add to the returned object:

```ts
    contentMemory,
```

- [ ] **Step 4: Run the stack test (vendor model first if needed)**

Run: `pnpm vitest run packages/conversation/tests/content-memory-stack.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the backend route**

Create `packages/backend/src/content-memory.ts`:

```ts
import { Hono } from 'hono'
import { z } from 'zod'
import { getStack } from './services.js'

const PLATFORM = z.enum([
  'instagram', 'tiktok', 'youtube', 'facebook', 'linkedin', 'x', 'threads', 'general',
])
const TASK_TYPE = z.enum([
  'analyze_competitor', 'build_brief', 'generate_content',
  'rewrite_content', 'review_content', 'create_calendar',
])

const BuildBody = z.object({
  workspaceId: z.string().min(1),
  platform: PLATFORM,
  taskType: TASK_TYPE,
  query: z.string().min(1),
  objective: z.string().min(1),
  campaignId: z.string().min(1).optional(),
  limitPerBucket: z.number().int().positive().max(20).optional(),
}).strict()

export const contentMemoryRoutes = new Hono()

contentMemoryRoutes.post('/context-pack', async (c) => {
  const body = BuildBody.parse(await c.req.json())
  const { pack, packId } = await getStack().contentMemory.buildForContentTask(body)
  return c.json({ ok: true, packId, pack })
})
```

- [ ] **Step 6: Register the route**

In `packages/backend/src/app.ts`:

Add the import (with the other route imports):

```ts
import { contentMemoryRoutes } from './content-memory.js'
```

Add the registration (with the other `app.route(...)` calls):

```ts
app.route('/content-memory', contentMemoryRoutes)
```

- [ ] **Step 7: Typecheck backend + conversation**

Run: `pnpm --filter @anubis/content-memory build && pnpm --filter @anubis/conversation typecheck && pnpm --filter @anubis/backend typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/conversation/src/index.ts packages/conversation/tests/content-memory-stack.test.ts packages/backend/src/content-memory.ts packages/backend/src/app.ts
git commit -m "feat(backend): expose ContentMemoryService over POST /content-memory/context-pack"
```

---

## Task 8: Full verification

- [ ] **Step 1: Build content-memory → conversation → backend**

Run: `pnpm --filter @anubis/content-memory build && pnpm --filter @anubis/conversation build && pnpm --filter @anubis/backend build`
Expected: all succeed.

- [ ] **Step 2: Run suites**

Run: `pnpm vitest run packages/content-memory && pnpm vitest run packages/conversation`
Expected: all green (vendor the model first for the stack test, or gate it).

- [ ] **Step 3: Repo-wide typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit (empty allowed)**

```bash
git add -A
git commit -m "test(content-memory): phase 3 context pack verified" --allow-empty
```

---

## Self-review

**Spec coverage (design §8 Phase 3 / original §13–15, §22.4):**
- Document embeddings + semantic retrieval → Task 1 (`searchSemantic`) + Task 2 (`KnowledgeIngestionService`).
- `ContentContextPack` shape (original §13) → Task 4 types; assembled in Task 5.
- Separate approved / competitor / **rejected** buckets, rejected never positive (original §14, §22.4) → Task 5 (three separate similarity queries) + test.
- Citations + final instruction → Task 5.
- `ContentMemoryService.buildForContentTask` + persistence (original §15, §9.6) → Task 6 + Task 3 (`content_context_packs`).
- HTTP surface → Task 7 (`POST /content-memory/context-pack`); workflow nodes call this route.

**Deliberately deferred:** `experienceMemory` section is empty here (Phase 4 fills it); validators + leakage check (Phase 5); `agent_runs` (Phase 5); `knowledge_chunks` granularity, `campaignContext`, and the framework sub-taxonomy (hooks/CTA/structures arrays) — documented inline as MVP-empty.

**Type consistency:** `Embedder` reused from Phase 2; `ScoredDocument`/`ScoredSimilarityItem` from Phases 1–2; `ContentContextPack`/`BuildContentContextInput` defined in Task 4 and consumed by Tasks 5–7; migration versions `[8,9,11,12,13]` consistent across the SQL filenames, `CONTENT_MEMORY_MIGRATIONS`, and the index test.

**Placeholder scan:** no TBD/TODO — empty MVP arrays are an explicit, documented design choice, not a placeholder.

**Risks:**
1. The stack test (Task 7) uses the real embedder → needs the vendored model. Gate with `RUN_MODEL_TESTS` if CI can't vendor.
2. `searchSemantic` is brute-force over the scoped active+embedded set; fine at MVP scale (see design §5).

---

## Execution handoff

Phase 4 (Experience Index — `experience_memories` store + `ExperienceIndexService.saveFeedback`, recall into the context pack's `experienceMemory` section, feedback HTTP route) gets its own plan once Phase 3 lands.
