# Scoped Content Memory — Phase 2 (Embeddings + Similarity Ingestion) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Prerequisite: Phase 1 plan (`2026-06-05-scoped-content-memory-phase1.md`) must be merged first.**

**Goal:** Add a local embedding model and a workspace-scoped similarity store, ingest existing `captured_posts` into it, and serve scope-safe vector similarity search — replacing Phase 1's lexical placeholder with real semantic ranking behind the same scope-before-rank invariant.

**Architecture:** `@anubis/content-memory` gains an `Embedder` abstraction (interface + a lazy `XenovaEmbedder` using `@xenova/transformers` / `all-MiniLM-L6-v2`, 384-dim), vector utilities (BLOB serialization + cosine), a `content_similarity_items` table + repo with scoped vector search, and a `SimilarityIngestionService`. `@anubis/conversation` wires a `CapturedPostsSimilarityIngestor` that joins `captured_posts` to `competitors.workspace_id` (added in Phase 1) and feeds the service, then exposes everything on `ConversationStack`. All ranking logic is tested with a deterministic `FakeEmbedder`; the real model gets one env-gated smoke test.

**Tech Stack:** TypeScript (ESM, NodeNext), better-sqlite3 (BLOB storage), `@xenova/transformers` (local ONNX embeddings), Vitest.

**Reference docs:** `docs/superpowers/specs/2026-06-05-scoped-content-memory-design.md` (§4.3, §5, §6 — this plan implements design §8 Phase 2), original `anubis-scoped-content-memory-spec.md` (§9.3 similarity items, §12 ranking, §19 feedback loop).

---

## Scope of this phase

In scope (design §8 Phase 2):

- `Embedder` interface + `XenovaEmbedder` (lazy model load) + vector utils (`toBlob`/`fromBlob`/`cosine`).
- `content_similarity_items` table (migration 011) + `ContentSimilarityItemsRepo` with scoped vector `search()`.
- `SimilarityIngestionService` (structural input — no dependency on conversation).
- Conversation-side `CapturedPostsSimilarityIngestor` (joins `captured_posts` → `competitors.workspace_id`) + `ConversationStack` exposure.
- Tests: cosine + BLOB round-trip, scoped-isolation vector search, ingestion, conversation join ingestion. Deterministic `FakeEmbedder`; one env-gated real-model smoke test.

Out of scope (later plans): `knowledge_chunks` embeddings, `ContentContextPack` assembly (Phase 3), `experience_memories` (Phase 4), validators (Phase 5), HTTP routes, workflow nodes. The `KnowledgeDocumentsRepo` lexical search from Phase 1 stays as-is for now; document embeddings are folded in during Phase 3 when the context pack needs them.

**Migration version bookkeeping:** Phase 1 reserved **8, 9** (content-memory) and **10** (conversation). Phase 2 takes **11** (content-memory). `content_similarity_items` references only `brand_workspaces` (migration 8), so content-memory's migrations remain self-contained and runnable without conversation's tables.

---

## File structure

New in `packages/content-memory/`:

```
src/embedding/
├── embedder.ts                 # Embedder interface
├── xenova-embedder.ts          # XenovaEmbedder (lazy @xenova/transformers)
└── vector.ts                   # toBlob / fromBlob / cosine
src/db/migrations/011_content_similarity_items.sql
src/db/repositories/content-similarity-items-repo.ts
src/similarity/
└── similarity-ingestion-service.ts
tests/
├── helpers/fake-embedder.ts
├── embedding/vector.test.ts
├── embedding/xenova-embedder.test.ts        # env-gated smoke test
├── content-similarity-items-repo.test.ts
└── similarity-ingestion-service.test.ts
```

Modified in `packages/content-memory/`:

```
package.json                          # + @xenova/transformers
src/types.ts                          # ContentType, ApprovalStatus
src/db/migrations/index.ts            # + load(11, ...)
src/index.ts                          # export embedding + similarity API
tests/migrations-index.test.ts        # expect [8, 9, 11]
```

Modified in `packages/conversation/`:

```
src/competitors/similarity-ingestor.ts   # NEW
src/index.ts                             # instantiate + expose on ConversationStack
tests/competitors/similarity-ingestor.test.ts  # NEW
```

---

## Task 1: Add the embedding dependency + similarity enums

**Files:**
- Modify: `packages/content-memory/package.json`
- Modify: `packages/content-memory/src/types.ts`
- Test: `packages/content-memory/tests/types.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `packages/content-memory/tests/types.test.ts`:

```ts
import { CONTENT_TYPES, APPROVAL_STATUSES } from '../src/types.js'

describe('similarity enums', () => {
  it('exposes the content types including competitor_post and rejected_post', () => {
    expect(CONTENT_TYPES).toContain('competitor_post')
    expect(CONTENT_TYPES).toContain('rejected_post')
  })

  it('exposes approval statuses', () => {
    expect(APPROVAL_STATUSES).toEqual(['approved', 'rejected', 'needs_review'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/content-memory/tests/types.test.ts`
Expected: FAIL — `CONTENT_TYPES` / `APPROVAL_STATUSES` not exported.

- [ ] **Step 3: Add the enums to `src/types.ts`**

Append to `packages/content-memory/src/types.ts`:

```ts
export type ContentType =
  | 'competitor_post'
  | 'own_post'
  | 'approved_post'
  | 'rejected_post'
  | 'generated_draft'

export const CONTENT_TYPES: readonly ContentType[] = [
  'competitor_post',
  'own_post',
  'approved_post',
  'rejected_post',
  'generated_draft',
]

export type ApprovalStatus = 'approved' | 'rejected' | 'needs_review'

export const APPROVAL_STATUSES: readonly ApprovalStatus[] = [
  'approved',
  'rejected',
  'needs_review',
]
```

- [ ] **Step 4: Add the embedding dependency to `package.json`**

In `packages/content-memory/package.json`, add to `dependencies`:

```json
    "@xenova/transformers": "^2.17.2",
```

Then run: `pnpm install`
Expected: completes (this pulls `onnxruntime-node`; first install may take a while).

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/content-memory/tests/types.test.ts`
Expected: PASS (4 tests total in this file).

- [ ] **Step 6: Commit**

```bash
git add packages/content-memory/package.json packages/content-memory/src/types.ts packages/content-memory/tests/types.test.ts pnpm-lock.yaml
git commit -m "feat(content-memory): add embedding dep and similarity enums"
```

---

## Task 2: Vector utilities (BLOB serialization + cosine)

**Files:**
- Create: `packages/content-memory/src/embedding/vector.ts`
- Test: `packages/content-memory/tests/embedding/vector.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/content-memory/tests/embedding/vector.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { toBlob, fromBlob, cosine } from '../../src/embedding/vector.js'

describe('vector utils', () => {
  it('round-trips a Float32Array through a BLOB', () => {
    const v = Float32Array.from([0.1, -0.2, 0.3, 0.4])
    const back = fromBlob(toBlob(v))
    expect(Array.from(back)).toHaveLength(4)
    for (let i = 0; i < v.length; i++) {
      expect(back[i]).toBeCloseTo(v[i]!, 6)
    }
  })

  it('cosine of identical vectors is 1', () => {
    const v = Float32Array.from([1, 2, 3])
    expect(cosine(v, v)).toBeCloseTo(1, 6)
  })

  it('cosine of orthogonal vectors is 0', () => {
    expect(cosine(Float32Array.from([1, 0]), Float32Array.from([0, 1]))).toBeCloseTo(0, 6)
  })

  it('cosine returns 0 when either vector is all zeros', () => {
    expect(cosine(Float32Array.from([0, 0]), Float32Array.from([1, 1]))).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/content-memory/tests/embedding/vector.test.ts`
Expected: FAIL — cannot resolve `../../src/embedding/vector.js`.

- [ ] **Step 3: Create `src/embedding/vector.ts`**

```ts
/** Serialize a Float32Array to a Buffer for BLOB storage. */
export function toBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength)
}

/** Deserialize a BLOB Buffer back to a Float32Array (copies for safe alignment). */
export function fromBlob(b: Buffer): Float32Array {
  const copy = Buffer.from(b)
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4)
}

/** Cosine similarity in [-1, 1]; returns 0 if either vector has zero magnitude. */
export function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < n; i++) {
    const x = a[i]!
    const y = b[i]!
    dot += x * y
    na += x * x
    nb += y * y
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/content-memory/tests/embedding/vector.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/content-memory/src/embedding/vector.ts packages/content-memory/tests/embedding/vector.test.ts
git commit -m "feat(content-memory): vector BLOB serialization + cosine"
```

---

## Task 3: Embedder interface, XenovaEmbedder, FakeEmbedder, and offline model vendoring

**Decision (offline-first):** the quantized model is **bundled in the installer**.
A `fetch-model` script vendors it into `packages/content-memory/models/` at build
time (network at build time only); electron-builder copies that into packaged
resources; `XenovaEmbedder` loads it with `allowRemoteModels = false` so there is
**no network at user runtime**.

**Files:**
- Create: `packages/content-memory/src/embedding/embedder.ts`
- Create: `packages/content-memory/src/embedding/xenova-embedder.ts`
- Create: `packages/content-memory/src/embedding/model-path.ts`
- Create: `packages/content-memory/scripts/fetch-model.mjs`
- Create: `packages/content-memory/tests/helpers/fake-embedder.ts`
- Test: `packages/content-memory/tests/embedding/xenova-embedder.test.ts`
- Modify: `packages/content-memory/package.json` (prebuild hook + `files`)
- Modify: `packages/content-memory/.gitignore` (ignore `models/`)
- Modify: `electron-builder.json` (extraResources for the model)

- [ ] **Step 1: Create the `Embedder` interface**

Create `packages/content-memory/src/embedding/embedder.ts`:

```ts
/** Produces a unit-length embedding vector for a text. */
export interface Embedder {
  /** Output dimensionality (e.g. 384 for all-MiniLM-L6-v2). */
  readonly dim: number
  embed(text: string): Promise<Float32Array>
}
```

- [ ] **Step 2: Create the deterministic `FakeEmbedder` test helper**

Create `packages/content-memory/tests/helpers/fake-embedder.ts`:

```ts
import type { Embedder } from '../../src/embedding/embedder.js'

/**
 * Deterministic, offline embedder for tests. Bag-of-char-codes → normalized
 * vector, so identical text yields cosine 1 and similar text ranks higher.
 */
export class FakeEmbedder implements Embedder {
  readonly dim: number
  constructor(dim = 16) {
    this.dim = dim
  }

  async embed(text: string): Promise<Float32Array> {
    const v = new Float32Array(this.dim)
    for (let i = 0; i < text.length; i++) {
      const slot = i % this.dim
      v[slot] = (v[slot] ?? 0) + text.charCodeAt(i)
    }
    let norm = 0
    for (let i = 0; i < this.dim; i++) norm += (v[i] ?? 0) * (v[i] ?? 0)
    norm = Math.sqrt(norm) || 1
    for (let i = 0; i < this.dim; i++) v[i] = (v[i] ?? 0) / norm
    return v
  }
}
```

- [ ] **Step 3: Create the bundled-model path helper**

Create `packages/content-memory/src/embedding/model-path.ts`:

```ts
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * Resolve the vendored model cache dir (package-relative). Works from both
 * src (dev/tsx) and dist, since `models/` sits at the package root beside both.
 * The packaged-app (electron asar/resources) path is wired by the caller — see
 * the design doc §9 open item.
 */
export function bundledModelCacheDir(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, '..', '..', 'models')
}
```

- [ ] **Step 4: Create the `XenovaEmbedder`**

Create `packages/content-memory/src/embedding/xenova-embedder.ts`:

```ts
import type { Embedder } from './embedder.js'

const MODEL = 'Xenova/all-MiniLM-L6-v2'

export interface XenovaEmbedderOptions {
  /** Directory holding the vendored model cache (offline use). */
  cacheDir?: string
  /** When false, never fetch from the network (offline-first). Default: true. */
  allowRemoteModels?: boolean
}

/**
 * Local embedding model via @xenova/transformers, loaded lazily on first
 * embed() (constructing at boot is cheap). When `allowRemoteModels: false` and
 * `cacheDir` points at the bundled model, runs fully offline.
 */
export class XenovaEmbedder implements Embedder {
  readonly dim = 384
  // The transformers pipeline has loose types; kept as a deferred promise.
  private pipe: Promise<(text: string, opts: object) => Promise<{ data: ArrayLike<number> }>> | null =
    null

  constructor(private opts: XenovaEmbedderOptions = {}) {}

  private load() {
    if (!this.pipe) {
      this.pipe = import('@xenova/transformers').then(({ pipeline, env }) => {
        if (this.opts.cacheDir) env.cacheDir = this.opts.cacheDir
        if (this.opts.allowRemoteModels === false) env.allowRemoteModels = false
        return pipeline('feature-extraction', MODEL) as unknown as Promise<
          (text: string, opts: object) => Promise<{ data: ArrayLike<number> }>
        >
      })
    }
    return this.pipe
  }

  async embed(text: string): Promise<Float32Array> {
    const extractor = await this.load()
    const output = await extractor(text, { pooling: 'mean', normalize: true })
    return Float32Array.from(output.data as Iterable<number>)
  }
}
```

- [ ] **Step 5: Write the env-gated smoke test**

Create `packages/content-memory/tests/embedding/xenova-embedder.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { XenovaEmbedder } from '../../src/embedding/xenova-embedder.js'
import { cosine } from '../../src/embedding/vector.js'

// Downloads the model on first run; opt in with RUN_MODEL_TESTS=1.
const run = process.env.RUN_MODEL_TESTS ? describe : describe.skip

run('XenovaEmbedder (real model)', () => {
  it('produces 384-dim vectors where related text is closer than unrelated', async () => {
    const e = new XenovaEmbedder()
    const a = await e.embed('skincare routine for sensitive skin')
    const b = await e.embed('gentle skincare for sensitive skin')
    const c = await e.embed('how to fix a car engine')
    expect(a).toHaveLength(384)
    expect(cosine(a, b)).toBeGreaterThan(cosine(a, c))
  }, 120_000)
})
```

- [ ] **Step 6: Run the suite (smoke test skipped by default)**

Run: `pnpm vitest run packages/content-memory/tests/embedding/xenova-embedder.test.ts`
Expected: PASS with the suite reported as skipped (no model download).

- [ ] **Step 7: Create the model-vendoring script**

Create `packages/content-memory/scripts/fetch-model.mjs`:

```js
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { pipeline, env } from '@xenova/transformers'

// Download into the package-local models/ dir at BUILD time (network here only).
const here = dirname(fileURLToPath(import.meta.url))
env.cacheDir = join(here, '..', 'models')
env.allowRemoteModels = true

await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
console.log('vendored model →', env.cacheDir)
```

- [ ] **Step 8: Wire the prebuild hook + ignore the vendored model**

In `packages/content-memory/package.json`, add a `prebuild` script and a `files`
field so the model is fetched before build and included when published/packaged:

```json
  "scripts": {
    "prebuild": "node ./scripts/fetch-model.mjs",
    "build": "tsc -p tsconfig.json && node ./scripts/copy-sql.mjs",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "files": ["dist", "models"],
```

Create `packages/content-memory/.gitignore`:

```gitignore
# Vendored embedding model (fetched at build time, not committed)
models/
```

- [ ] **Step 9: Add the model to the packaged app's resources**

In root `electron-builder.json`, add (or extend) `extraResources` so the vendored
model is copied into the packaged app's resources directory:

```json
  "extraResources": [
    { "from": "packages/content-memory/models", "to": "models" }
  ]
```

Note: at runtime the packaged backend should resolve `cacheDir` as
`join(process.resourcesPath, 'models')`; in dev it uses `bundledModelCacheDir()`.
This dev-vs-packaged selection is the one open wiring item (design §9.3); Phase 2
wires the dev path (Task 7) and this step records the packaged path.

- [ ] **Step 10: Vendor the model and verify it loads offline**

Run: `pnpm --filter @anubis/content-memory exec node ./scripts/fetch-model.mjs`
Expected: prints `vendored model → …/models`; the `models/` dir now contains the
ONNX model files.

Run: `RUN_MODEL_TESTS=1 pnpm vitest run packages/content-memory/tests/embedding/xenova-embedder.test.ts`
(PowerShell: `$env:RUN_MODEL_TESTS=1; pnpm vitest run packages/content-memory/tests/embedding/xenova-embedder.test.ts`)
Expected: PASS — model loads from the vendored cache.

- [ ] **Step 11: Commit**

```bash
git add packages/content-memory/src/embedding/embedder.ts packages/content-memory/src/embedding/xenova-embedder.ts packages/content-memory/src/embedding/model-path.ts packages/content-memory/scripts/fetch-model.mjs packages/content-memory/package.json packages/content-memory/.gitignore packages/content-memory/tests/helpers/fake-embedder.ts packages/content-memory/tests/embedding/xenova-embedder.test.ts electron-builder.json
git commit -m "feat(content-memory): Embedder + XenovaEmbedder + offline-bundled model"
```

---

## Task 4: `content_similarity_items` migration + scoped vector search repo

**Files:**
- Create: `packages/content-memory/src/db/migrations/011_content_similarity_items.sql`
- Create: `packages/content-memory/src/db/repositories/content-similarity-items-repo.ts`
- Test: `packages/content-memory/tests/content-similarity-items-repo.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/content-memory/tests/content-similarity-items-repo.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { freshDb } from './helpers/db.js'
import { BrandWorkspacesRepo } from '../src/db/repositories/brand-workspaces-repo.js'
import {
  ContentSimilarityItemsRepo,
  type ContentSimilarityItem,
} from '../src/db/repositories/content-similarity-items-repo.js'

const here = dirname(fileURLToPath(import.meta.url))
function sqlFor(file: string): string {
  return readFileSync(join(here, '../src/db/migrations', file), 'utf8')
}
const migrations = [
  { version: 8, sql: sqlFor('008_brand_workspaces.sql') },
  { version: 11, sql: sqlFor('011_content_similarity_items.sql') },
]

function setup() {
  const db = freshDb(migrations)
  const workspaces = new BrandWorkspacesRepo(db)
  for (const id of ['workspace-a', 'workspace-b']) {
    workspaces.insert({
      id, name: id, brandSummary: null,
      toneOfVoice: [], audience: [], offers: [], constraints: [],
      status: 'active', createdAt: 100, updatedAt: 100,
    })
  }
  return new ContentSimilarityItemsRepo(db)
}

function item(over: Partial<ContentSimilarityItem>): ContentSimilarityItem {
  return {
    id: over.id ?? `i-${Math.random().toString(36).slice(2)}`,
    workspaceId: over.workspaceId ?? 'workspace-a',
    platform: over.platform ?? 'instagram',
    contentId: over.contentId ?? null,
    contentType: over.contentType ?? 'competitor_post',
    caption: over.caption ?? null,
    transcript: over.transcript ?? null,
    ocrText: over.ocrText ?? null,
    visualDescription: over.visualDescription ?? null,
    normalizedText: over.normalizedText ?? 'text',
    embedding: over.embedding ?? Float32Array.from([1, 0, 0, 0]),
    performanceScore: over.performanceScore ?? null,
    engagementScore: over.engagementScore ?? null,
    brandFitScore: over.brandFitScore ?? null,
    approvalStatus: over.approvalStatus ?? null,
    rejectionReason: over.rejectionReason ?? null,
    createdAt: over.createdAt ?? 100,
    updatedAt: over.updatedAt ?? 100,
  }
}

describe('ContentSimilarityItemsRepo', () => {
  it('round-trips an item including its embedding', () => {
    const repo = setup()
    repo.upsert(item({ id: 'x1', embedding: Float32Array.from([0.5, 0.5, 0.5, 0.5]) }))
    const got = repo.search({
      workspaceId: 'workspace-a', platform: 'instagram',
      queryEmbedding: Float32Array.from([0.5, 0.5, 0.5, 0.5]),
    })
    expect(got[0]?.id).toBe('x1')
    expect(Array.from(got[0]!.embedding)).toHaveLength(4)
  })

  it('never returns items from another workspace (scope before rank)', () => {
    const repo = setup()
    repo.upsert(item({ workspaceId: 'workspace-a', embedding: Float32Array.from([1, 0, 0, 0]) }))
    repo.upsert(item({ workspaceId: 'workspace-b', embedding: Float32Array.from([1, 0, 0, 0]) }))
    const results = repo.search({
      workspaceId: 'workspace-a', platform: 'instagram',
      queryEmbedding: Float32Array.from([1, 0, 0, 0]),
    })
    expect(results.every((r) => r.workspaceId === 'workspace-a')).toBe(true)
  })

  it('ranks by cosine similarity to the query', () => {
    const repo = setup()
    repo.upsert(item({ id: 'near', embedding: Float32Array.from([1, 0, 0, 0]) }))
    repo.upsert(item({ id: 'far', embedding: Float32Array.from([0, 1, 0, 0]) }))
    const results = repo.search({
      workspaceId: 'workspace-a', platform: 'instagram',
      queryEmbedding: Float32Array.from([1, 0, 0, 0]),
    })
    expect(results.map((r) => r.id)).toEqual(['near', 'far'])
  })

  it('filters by content type and platform', () => {
    const repo = setup()
    repo.upsert(item({ id: 'comp', contentType: 'competitor_post' }))
    repo.upsert(item({ id: 'rej', contentType: 'rejected_post' }))
    repo.upsert(item({ id: 'tiktok', platform: 'tiktok', contentType: 'competitor_post' }))
    const results = repo.search({
      workspaceId: 'workspace-a', platform: 'instagram',
      queryEmbedding: Float32Array.from([1, 0, 0, 0]),
      contentTypes: ['rejected_post'],
    })
    expect(results.map((r) => r.id)).toEqual(['rej'])
  })

  it('upserts by (workspaceId, contentId) keeping the original id', () => {
    const repo = setup()
    repo.upsert(item({ id: 'first', contentId: 'post-1', normalizedText: 'v1' }))
    repo.upsert(item({ id: 'second', contentId: 'post-1', normalizedText: 'v2' }))
    const results = repo.search({
      workspaceId: 'workspace-a', platform: 'instagram',
      queryEmbedding: Float32Array.from([1, 0, 0, 0]),
    })
    expect(results).toHaveLength(1)
    expect(results[0]!.id).toBe('first')
    expect(results[0]!.normalizedText).toBe('v2')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/content-memory/tests/content-similarity-items-repo.test.ts`
Expected: FAIL — migration SQL / repo module not found.

- [ ] **Step 3: Create the migration SQL**

Create `packages/content-memory/src/db/migrations/011_content_similarity_items.sql`:

```sql
-- Workspace-scoped similarity store. Embeddings inline as BLOB; cosine ranking in JS.
CREATE TABLE content_similarity_items (
  id                 TEXT PRIMARY KEY,
  workspace_id       TEXT NOT NULL REFERENCES brand_workspaces(id),
  platform           TEXT NOT NULL,
  content_id         TEXT,                          -- e.g. captured_posts.id (no FK: items outlive posts)
  content_type       TEXT NOT NULL CHECK (content_type IN
                       ('competitor_post', 'own_post', 'approved_post', 'rejected_post', 'generated_draft')),
  caption            TEXT,
  transcript         TEXT,
  ocr_text           TEXT,
  visual_description TEXT,
  normalized_text    TEXT NOT NULL,
  embedding          BLOB NOT NULL,
  performance_score  REAL,
  engagement_score   REAL,
  brand_fit_score    REAL,
  approval_status    TEXT CHECK (approval_status IS NULL OR approval_status IN
                       ('approved', 'rejected', 'needs_review')),
  rejection_reason   TEXT,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);

CREATE INDEX idx_similarity_workspace_platform
  ON content_similarity_items(workspace_id, platform);

-- Upsert key: one row per (workspace, source content). NULL content_id never conflicts.
CREATE UNIQUE INDEX uq_similarity_content
  ON content_similarity_items(workspace_id, content_id)
  WHERE content_id IS NOT NULL;
```

- [ ] **Step 4: Create the repo**

Create `packages/content-memory/src/db/repositories/content-similarity-items-repo.ts`:

```ts
import type { Db } from '../types.js'
import type { ApprovalStatus, ContentType, Platform } from '../../types.js'
import { cosine, fromBlob, toBlob } from '../../embedding/vector.js'

export interface ContentSimilarityItem {
  id: string
  workspaceId: string
  platform: Platform
  contentId: string | null
  contentType: ContentType
  caption: string | null
  transcript: string | null
  ocrText: string | null
  visualDescription: string | null
  normalizedText: string
  embedding: Float32Array
  performanceScore: number | null
  engagementScore: number | null
  brandFitScore: number | null
  approvalStatus: ApprovalStatus | null
  rejectionReason: string | null
  createdAt: number
  updatedAt: number
}

export interface SearchSimilarInput {
  workspaceId: string
  platform: Platform
  queryEmbedding: Float32Array
  contentTypes?: ContentType[]
  approvalStatuses?: ApprovalStatus[]
  limit?: number
}

export type ScoredSimilarityItem = ContentSimilarityItem & { score: number }

interface Row {
  id: string
  workspace_id: string
  platform: string
  content_id: string | null
  content_type: string
  caption: string | null
  transcript: string | null
  ocr_text: string | null
  visual_description: string | null
  normalized_text: string
  embedding: Buffer
  performance_score: number | null
  engagement_score: number | null
  brand_fit_score: number | null
  approval_status: string | null
  rejection_reason: string | null
  created_at: number
  updated_at: number
}

function toItem(r: Row): ContentSimilarityItem {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    platform: r.platform as Platform,
    contentId: r.content_id,
    contentType: r.content_type as ContentType,
    caption: r.caption,
    transcript: r.transcript,
    ocrText: r.ocr_text,
    visualDescription: r.visual_description,
    normalizedText: r.normalized_text,
    embedding: fromBlob(r.embedding),
    performanceScore: r.performance_score,
    engagementScore: r.engagement_score,
    brandFitScore: r.brand_fit_score,
    approvalStatus: (r.approval_status as ApprovalStatus | null) ?? null,
    rejectionReason: r.rejection_reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export class ContentSimilarityItemsRepo {
  constructor(private db: Db) {}

  upsert(it: ContentSimilarityItem): void {
    this.db.prepare(`
      INSERT INTO content_similarity_items (
        id, workspace_id, platform, content_id, content_type, caption, transcript,
        ocr_text, visual_description, normalized_text, embedding, performance_score,
        engagement_score, brand_fit_score, approval_status, rejection_reason,
        created_at, updated_at
      ) VALUES (
        @id, @workspaceId, @platform, @contentId, @contentType, @caption, @transcript,
        @ocrText, @visualDescription, @normalizedText, @embedding, @performanceScore,
        @engagementScore, @brandFitScore, @approvalStatus, @rejectionReason,
        @createdAt, @updatedAt
      )
      ON CONFLICT(workspace_id, content_id) WHERE content_id IS NOT NULL DO UPDATE SET
        platform = excluded.platform,
        content_type = excluded.content_type,
        caption = excluded.caption,
        transcript = excluded.transcript,
        ocr_text = excluded.ocr_text,
        visual_description = excluded.visual_description,
        normalized_text = excluded.normalized_text,
        embedding = excluded.embedding,
        performance_score = excluded.performance_score,
        engagement_score = excluded.engagement_score,
        brand_fit_score = excluded.brand_fit_score,
        approval_status = excluded.approval_status,
        rejection_reason = excluded.rejection_reason,
        updated_at = excluded.updated_at
    `).run({
      id: it.id,
      workspaceId: it.workspaceId,
      platform: it.platform,
      contentId: it.contentId ?? null,
      contentType: it.contentType,
      caption: it.caption ?? null,
      transcript: it.transcript ?? null,
      ocrText: it.ocrText ?? null,
      visualDescription: it.visualDescription ?? null,
      normalizedText: it.normalizedText,
      embedding: toBlob(it.embedding),
      performanceScore: it.performanceScore ?? null,
      engagementScore: it.engagementScore ?? null,
      brandFitScore: it.brandFitScore ?? null,
      approvalStatus: it.approvalStatus ?? null,
      rejectionReason: it.rejectionReason ?? null,
      createdAt: it.createdAt,
      updatedAt: it.updatedAt,
    })
  }

  /** Scope (workspace + platform) filtered in SQL BEFORE cosine ranking in JS. */
  search(input: SearchSimilarInput): ScoredSimilarityItem[] {
    const where: string[] = ['workspace_id = ?', 'platform = ?']
    const params: unknown[] = [input.workspaceId, input.platform]

    if (input.contentTypes?.length) {
      where.push(`content_type IN (${input.contentTypes.map(() => '?').join(', ')})`)
      params.push(...input.contentTypes)
    }
    if (input.approvalStatuses?.length) {
      where.push(`approval_status IN (${input.approvalStatuses.map(() => '?').join(', ')})`)
      params.push(...input.approvalStatuses)
    }

    const rows = this.db
      .prepare(`SELECT * FROM content_similarity_items WHERE ${where.join(' AND ')}`)
      .all(...params) as Row[]

    const scored = rows
      .map(toItem)
      .map((it) => ({ ...it, score: cosine(it.embedding, input.queryEmbedding) }))
      .sort((a, b) => b.score - a.score || b.createdAt - a.createdAt)

    return typeof input.limit === 'number' ? scored.slice(0, input.limit) : scored
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/content-memory/tests/content-similarity-items-repo.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/content-memory/src/db/migrations/011_content_similarity_items.sql packages/content-memory/src/db/repositories/content-similarity-items-repo.ts packages/content-memory/tests/content-similarity-items-repo.test.ts
git commit -m "feat(content-memory): content_similarity_items store with scoped vector search"
```

---

## Task 5: `SimilarityIngestionService`

**Files:**
- Create: `packages/content-memory/src/similarity/similarity-ingestion-service.ts`
- Test: `packages/content-memory/tests/similarity-ingestion-service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/content-memory/tests/similarity-ingestion-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { freshDb } from './helpers/db.js'
import { FakeEmbedder } from './helpers/fake-embedder.js'
import { BrandWorkspacesRepo } from '../src/db/repositories/brand-workspaces-repo.js'
import { ContentSimilarityItemsRepo } from '../src/db/repositories/content-similarity-items-repo.js'
import {
  SimilarityIngestionService,
  normalizeSimilarityText,
} from '../src/similarity/similarity-ingestion-service.js'

const here = dirname(fileURLToPath(import.meta.url))
function sqlFor(file: string): string {
  return readFileSync(join(here, '../src/db/migrations', file), 'utf8')
}
const migrations = [
  { version: 8, sql: sqlFor('008_brand_workspaces.sql') },
  { version: 11, sql: sqlFor('011_content_similarity_items.sql') },
]

function setup() {
  const db = freshDb(migrations)
  new BrandWorkspacesRepo(db).insert({
    id: 'workspace-a', name: 'A', brandSummary: null,
    toneOfVoice: [], audience: [], offers: [], constraints: [],
    status: 'active', createdAt: 100, updatedAt: 100,
  })
  const items = new ContentSimilarityItemsRepo(db)
  const svc = new SimilarityIngestionService(items, new FakeEmbedder())
  return { items, svc }
}

describe('normalizeSimilarityText', () => {
  it('joins present fields and drops empties', () => {
    expect(normalizeSimilarityText({
      caption: 'cap', transcript: '', ocrText: 'ocr', visualDescription: null,
    })).toBe('cap\nocr')
  })
})

describe('SimilarityIngestionService', () => {
  it('embeds and stores an item, retrievable by similarity', async () => {
    const { svc, items } = setup()
    await svc.ingest({
      workspaceId: 'workspace-a', platform: 'instagram',
      contentId: 'post-1', contentType: 'competitor_post',
      caption: 'gentle skincare for sensitive skin',
    })
    const q = await new FakeEmbedder().embed('gentle skincare for sensitive skin')
    const results = items.search({
      workspaceId: 'workspace-a', platform: 'instagram', queryEmbedding: q,
    })
    expect(results).toHaveLength(1)
    expect(results[0]!.contentId).toBe('post-1')
    expect(results[0]!.score).toBeCloseTo(1, 6)
  })

  it('re-ingesting the same contentId updates in place', async () => {
    const { svc, items } = setup()
    await svc.ingest({
      workspaceId: 'workspace-a', platform: 'instagram',
      contentId: 'post-1', contentType: 'competitor_post', caption: 'first',
    })
    await svc.ingest({
      workspaceId: 'workspace-a', platform: 'instagram',
      contentId: 'post-1', contentType: 'competitor_post', caption: 'second',
    })
    const q = await new FakeEmbedder().embed('anything')
    const results = items.search({
      workspaceId: 'workspace-a', platform: 'instagram', queryEmbedding: q,
    })
    expect(results).toHaveLength(1)
    expect(results[0]!.caption).toBe('second')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/content-memory/tests/similarity-ingestion-service.test.ts`
Expected: FAIL — service module not found.

- [ ] **Step 3: Create the service**

Create `packages/content-memory/src/similarity/similarity-ingestion-service.ts`:

```ts
import { randomUUID } from 'node:crypto'
import type { ApprovalStatus, ContentType, Platform } from '../types.js'
import type { Embedder } from '../embedding/embedder.js'
import type {
  ContentSimilarityItem,
  ContentSimilarityItemsRepo,
} from '../db/repositories/content-similarity-items-repo.js'

export interface IngestSimilarityInput {
  workspaceId: string
  platform: Platform
  contentId: string | null
  contentType: ContentType
  caption?: string | null
  transcript?: string | null
  ocrText?: string | null
  visualDescription?: string | null
  performanceScore?: number | null
  engagementScore?: number | null
  brandFitScore?: number | null
  approvalStatus?: ApprovalStatus | null
  rejectionReason?: string | null
}

/** Join the text-bearing fields into the string that gets embedded. */
export function normalizeSimilarityText(p: {
  caption?: string | null
  transcript?: string | null
  ocrText?: string | null
  visualDescription?: string | null
}): string {
  return [p.caption, p.transcript, p.ocrText, p.visualDescription]
    .map((s) => (s ?? '').trim())
    .filter((s) => s.length > 0)
    .join('\n')
}

export class SimilarityIngestionService {
  constructor(
    private items: ContentSimilarityItemsRepo,
    private embedder: Embedder,
  ) {}

  async ingest(
    input: IngestSimilarityInput,
    now: number = Date.now(),
  ): Promise<ContentSimilarityItem> {
    const normalizedText = normalizeSimilarityText(input)
    const embedding = await this.embedder.embed(normalizedText || input.contentType)
    const item: ContentSimilarityItem = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      platform: input.platform,
      contentId: input.contentId,
      contentType: input.contentType,
      caption: input.caption ?? null,
      transcript: input.transcript ?? null,
      ocrText: input.ocrText ?? null,
      visualDescription: input.visualDescription ?? null,
      normalizedText,
      embedding,
      performanceScore: input.performanceScore ?? null,
      engagementScore: input.engagementScore ?? null,
      brandFitScore: input.brandFitScore ?? null,
      approvalStatus: input.approvalStatus ?? null,
      rejectionReason: input.rejectionReason ?? null,
      createdAt: now,
      updatedAt: now,
    }
    this.items.upsert(item)
    return item
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/content-memory/tests/similarity-ingestion-service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/content-memory/src/similarity/similarity-ingestion-service.ts packages/content-memory/tests/similarity-ingestion-service.test.ts
git commit -m "feat(content-memory): SimilarityIngestionService"
```

---

## Task 6: Register migration 011 + public exports

**Files:**
- Modify: `packages/content-memory/src/db/migrations/index.ts`
- Modify: `packages/content-memory/src/index.ts`
- Modify: `packages/content-memory/tests/migrations-index.test.ts`

- [ ] **Step 1: Update the migrations-index test (expect 11)**

Replace the assertion in `packages/content-memory/tests/migrations-index.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { CONTENT_MEMORY_MIGRATIONS } from '../src/db/migrations/index.js'

describe('CONTENT_MEMORY_MIGRATIONS', () => {
  it('exports versions 8, 9, 11 with non-empty SQL', () => {
    const versions = CONTENT_MEMORY_MIGRATIONS.map((m) => m.version)
    expect(versions).toEqual([8, 9, 11])
    for (const m of CONTENT_MEMORY_MIGRATIONS) {
      expect(m.sql.length).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/content-memory/tests/migrations-index.test.ts`
Expected: FAIL — versions are `[8, 9]`, expected `[8, 9, 11]`.

- [ ] **Step 3: Register migration 011**

In `packages/content-memory/src/db/migrations/index.ts`, update the array:

```ts
export const CONTENT_MEMORY_MIGRATIONS: Migration[] = [
  load(8, '008_brand_workspaces.sql'),
  load(9, '009_knowledge_documents.sql'),
  // 10 is owned by @anubis/conversation (competitors ALTER).
  load(11, '011_content_similarity_items.sql'),
]
```

- [ ] **Step 4: Add the new public exports**

Append to `packages/content-memory/src/index.ts`:

```ts
export type { ContentType, ApprovalStatus } from './types.js'
export { CONTENT_TYPES, APPROVAL_STATUSES } from './types.js'

export type { Embedder } from './embedding/embedder.js'
export type { XenovaEmbedderOptions } from './embedding/xenova-embedder.js'
export { XenovaEmbedder } from './embedding/xenova-embedder.js'
export { bundledModelCacheDir } from './embedding/model-path.js'
export { toBlob, fromBlob, cosine } from './embedding/vector.js'

export type {
  ContentSimilarityItem,
  SearchSimilarInput,
  ScoredSimilarityItem,
} from './db/repositories/content-similarity-items-repo.js'
export { ContentSimilarityItemsRepo } from './db/repositories/content-similarity-items-repo.js'

export type { IngestSimilarityInput } from './similarity/similarity-ingestion-service.js'
export {
  SimilarityIngestionService,
  normalizeSimilarityText,
} from './similarity/similarity-ingestion-service.js'
```

- [ ] **Step 5: Run test + typecheck + build**

Run: `pnpm vitest run packages/content-memory/tests/migrations-index.test.ts`
Expected: PASS.

Run: `pnpm --filter @anubis/content-memory typecheck && pnpm --filter @anubis/content-memory build`
Expected: no errors; SQL copy line printed.

- [ ] **Step 6: Commit**

```bash
git add packages/content-memory/src/db/migrations/index.ts packages/content-memory/src/index.ts packages/content-memory/tests/migrations-index.test.ts
git commit -m "feat(content-memory): register similarity migration and export embedding/similarity API"
```

---

## Task 7: Wire ingestion into `@anubis/conversation`

**Files:**
- Create: `packages/conversation/src/competitors/similarity-ingestor.ts`
- Modify: `packages/conversation/src/index.ts`
- Test: `packages/conversation/tests/competitors/similarity-ingestor.test.ts`

The ingestor joins `captured_posts` to `competitors.workspace_id` (the column added in Phase 1) and feeds each post to the `SimilarityIngestionService` as a `competitor_post`.

- [ ] **Step 1: Write the failing test**

Create `packages/conversation/tests/competitors/similarity-ingestor.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  ContentSimilarityItemsRepo,
  SimilarityIngestionService,
  type Embedder,
} from '@anubis/content-memory'
import { openDatabase } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { CompetitorsRepo } from '../../src/db/repositories/competitors-repo.js'
import { CapturedPostsRepo } from '../../src/db/repositories/captured-posts-repo.js'
import { CapturedPostsSimilarityIngestor } from '../../src/competitors/similarity-ingestor.js'

// Minimal deterministic embedder (Embedder interface is the only contract).
class TinyEmbedder implements Embedder {
  readonly dim = 8
  async embed(text: string): Promise<Float32Array> {
    const v = new Float32Array(this.dim)
    for (let i = 0; i < text.length; i++) v[i % this.dim] = (v[i % this.dim] ?? 0) + text.charCodeAt(i)
    return v
  }
}

function setup() {
  const db = openDatabase(':memory:')
  runMigrations(db, MIGRATIONS)
  const competitors = new CompetitorsRepo(db)
  const posts = new CapturedPostsRepo(db)
  const items = new ContentSimilarityItemsRepo(db)
  const ingestion = new SimilarityIngestionService(items, new TinyEmbedder())
  const ingestor = new CapturedPostsSimilarityIngestor(db, ingestion)
  return { db, competitors, posts, items, ingestor }
}

describe('CapturedPostsSimilarityIngestor', () => {
  it('ingests captured posts scoped to their brand workspace', async () => {
    const { competitors, posts, items, ingestor } = setup()
    competitors.insert({
      id: 'comp-a', handle: '@a', postCount: 0, addedAt: 1, updatedAt: 1,
      workspaceId: 'default-workspace',
    })
    posts.upsert({
      id: 'p1', competitorId: 'comp-a', username: '@a',
      postUrl: 'https://insta/p1', caption: 'great skincare tips',
      likes: 100, comments: 5, capturedAt: 10,
    })

    const res = await ingestor.ingestForWorkspace('default-workspace')
    expect(res.ingested).toBe(1)

    const q = await new TinyEmbedder().embed('great skincare tips')
    const found = items.search({
      workspaceId: 'default-workspace', platform: 'instagram', queryEmbedding: q,
    })
    expect(found).toHaveLength(1)
    expect(found[0]!.contentId).toBe('p1')
    expect(found[0]!.contentType).toBe('competitor_post')
    expect(found[0]!.engagementScore).toBe(105)
  })

  it('does not ingest posts whose competitor belongs to another workspace', async () => {
    const { competitors, posts, ingestor } = setup()
    competitors.insert({
      id: 'comp-b', handle: '@b', postCount: 0, addedAt: 1, updatedAt: 1,
      workspaceId: 'workspace-other',
    })
    posts.upsert({
      id: 'p2', competitorId: 'comp-b', username: '@b',
      postUrl: 'https://insta/p2', caption: 'other brand', capturedAt: 10,
    })
    // Note: workspace-other has no brand_workspaces row, but the ingestor
    // filters by competitor.workspace_id and should simply find nothing here.
    const res = await ingestor.ingestForWorkspace('default-workspace')
    expect(res.ingested).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/conversation/tests/competitors/similarity-ingestor.test.ts`
Expected: FAIL — ingestor module not found.

- [ ] **Step 3: Create the ingestor**

Create `packages/conversation/src/competitors/similarity-ingestor.ts`:

```ts
import type { Platform, SimilarityIngestionService } from '@anubis/content-memory'
import type { Db } from '../db/client.js'

interface JoinRow {
  id: string
  caption: string | null
  likes: number | null
  comments: number | null
}

const INSTAGRAM: Platform = 'instagram'

/**
 * Ingests captured posts into the workspace-scoped similarity store. Scope is
 * derived from competitors.workspace_id (added in Phase 1); captured_posts are
 * Instagram-only today.
 */
export class CapturedPostsSimilarityIngestor {
  constructor(
    private db: Db,
    private ingestion: SimilarityIngestionService,
  ) {}

  async ingestForWorkspace(workspaceId: string): Promise<{ ingested: number }> {
    const rows = this.db
      .prepare(`
        SELECT cp.id AS id, cp.caption AS caption, cp.likes AS likes, cp.comments AS comments
        FROM captured_posts cp
        JOIN competitors c ON c.id = cp.competitor_id
        WHERE c.deleted_at IS NULL AND c.workspace_id = ?
      `)
      .all(workspaceId) as JoinRow[]

    for (const r of rows) {
      const engagement =
        r.likes == null && r.comments == null ? null : (r.likes ?? 0) + (r.comments ?? 0)
      await this.ingestion.ingest({
        workspaceId,
        platform: INSTAGRAM,
        contentId: r.id,
        contentType: 'competitor_post',
        caption: r.caption,
        engagementScore: engagement,
      })
    }

    return { ingested: rows.length }
  }
}
```

- [ ] **Step 4: Expose on `ConversationStack`**

In `packages/conversation/src/index.ts`:

Extend the `@anubis/content-memory` import (added in Phase 1) to include the new symbols:

```ts
import {
  ContentSimilarityItemsRepo,
  BrandWorkspacesRepo,
  BrandWorkspacesService,
  KnowledgeDocumentsRepo,
  SimilarityIngestionService,
  XenovaEmbedder,
  bundledModelCacheDir,
} from '@anubis/content-memory'
import { CapturedPostsSimilarityIngestor } from './competitors/similarity-ingestor.js'
```

Add to the `ConversationStack` interface (after `knowledgeDocuments: KnowledgeDocumentsRepo` from Phase 1):

```ts
  similarityItems: ContentSimilarityItemsRepo
  similarityIngestion: SimilarityIngestionService
  capturedPostsSimilarity: CapturedPostsSimilarityIngestor
```

In `createConversationService`, after the Phase 1 `knowledgeDocuments` instantiation:

```ts
  // Offline-first: load the bundled model, never hit the network. In the
  // packaged app, swap cacheDir for join(process.resourcesPath, 'models')
  // (design §9 open item).
  const contentEmbedder = new XenovaEmbedder({
    cacheDir: bundledModelCacheDir(),
    allowRemoteModels: false,
  })
  const similarityItems = new ContentSimilarityItemsRepo(db)
  const similarityIngestion = new SimilarityIngestionService(similarityItems, contentEmbedder)
  const capturedPostsSimilarity = new CapturedPostsSimilarityIngestor(db, similarityIngestion)
```

Add to the returned object (alongside `knowledgeDocuments`):

```ts
    similarityItems,
    similarityIngestion,
    capturedPostsSimilarity,
```

- [ ] **Step 5: Run the new test to verify it passes**

Run: `pnpm vitest run packages/conversation/tests/competitors/similarity-ingestor.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Run the full conversation suite**

Run: `pnpm vitest run packages/conversation`
Expected: all green (no regressions; the stack gains fields but instantiation is lazy — `XenovaEmbedder` loads no model until `embed()` is called).

- [ ] **Step 7: Commit**

```bash
git add packages/conversation/src/competitors/similarity-ingestor.ts packages/conversation/src/index.ts packages/conversation/tests/competitors/similarity-ingestor.test.ts
git commit -m "feat(conversation): ingest captured posts into scoped similarity store"
```

---

## Task 8: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Build content-memory then conversation**

Run: `pnpm --filter @anubis/content-memory build && pnpm --filter @anubis/conversation build`
Expected: both succeed.

- [ ] **Step 2: Run the content-memory suite**

Run: `pnpm vitest run packages/content-memory`
Expected: all pass (types, vector, embedder smoke skipped, similarity repo, ingestion service, migrations index, plus Phase 1 tests).

- [ ] **Step 3: Run the conversation suite**

Run: `pnpm vitest run packages/conversation`
Expected: all green.

- [ ] **Step 4: Optional — exercise the real model**

Run: `RUN_MODEL_TESTS=1 pnpm vitest run packages/content-memory/tests/embedding/xenova-embedder.test.ts`
Expected: PASS (downloads `all-MiniLM-L6-v2` on first run; related text scores higher than unrelated). On Windows PowerShell use: `$env:RUN_MODEL_TESTS=1; pnpm vitest run packages/content-memory/tests/embedding/xenova-embedder.test.ts`

- [ ] **Step 5: Repo-wide typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Final commit (empty allowed)**

```bash
git add -A
git commit -m "test(content-memory): phase 2 embeddings + similarity verified" --allow-empty
```

---

## Self-review (completed against the design + original spec)

**Spec coverage (design §8 Phase 2):**
- Local embedder (design §5) → Task 3 (`XenovaEmbedder`, lazy, 384-dim) + Task 2 (vector utils).
- `content_similarity_items` with inline embedding BLOB (design §4.3, original §9.3) → Task 4.
- Scope-before-rank vector search (design §6, original §12) → Task 4 (`search()` filters workspace+platform in SQL, cosine in JS).
- Ingest `captured_posts` → similarity items → Task 5 (service) + Task 7 (conversation join by `competitors.workspace_id`).
- Separation for approved vs rejected examples (original §14, §19) → supported via `contentTypes`/`approvalStatuses` filters in `search()` (consumed by Phase 3's context pack).
- Exposed on `ConversationStack` → Task 7.

**Deliberately deferred (later plans):** `knowledge_chunks` embeddings + replacing Phase 1's lexical doc search with semantic ranking (Phase 3), `ContentContextPack` assembly (Phase 3), `experience_memories` (Phase 4), validators (Phase 5), HTTP routes, workflow nodes.

**Type consistency:** `Embedder` (Task 3) is the single contract used by `XenovaEmbedder`, `FakeEmbedder`, the conversation test's `TinyEmbedder`, and `SimilarityIngestionService`. `ContentSimilarityItem` shape is identical across repo (Task 4), service (Task 5), and exports (Task 6). `toBlob`/`fromBlob`/`cosine` defined in Task 2 and used in Task 4. `Platform`/`ContentType`/`ApprovalStatus` come from `src/types.ts` (Task 1). Migration version `11` is consistent across the SQL filename, `CONTENT_MEMORY_MIGRATIONS`, and the updated index test.

**Placeholder scan:** no TBD/TODO/"handle edge cases"/"similar to" — every code, SQL, and test step is complete.

**Embedding delivery (decided — offline-first bundling):**
- The quantized model is vendored at build time (`fetch-model.mjs` → `models/`,
  gitignored) and bundled into the installer via electron-builder
  `extraResources` (Task 3). Runtime uses `allowRemoteModels: false` → **no user
  network**. This supersedes the earlier "download on first use" option.

**Risks / open items (flagged, not blocking):**
1. `@xenova/transformers` pulls `onnxruntime-node` (native). Confirm it is added to the root `pnpm.onlyBuiltDependencies` list if install/rebuild warns, and that it survives `electron-builder` packaging (the backend runs as a Node child process, not in the renderer). Validate when the embedder is first invoked at runtime.
2. Packaged model path: in dev, `bundledModelCacheDir()` resolves the package-local `models/`; in the packaged app the model lives at `process.resourcesPath/models` (from `extraResources`). The dev-vs-packaged `cacheDir` selection is the single open wiring item (design §9.3) — Task 7 wires the dev path; confirm the packaged path during an `electron-builder` smoke build.
3. Build-time download: `fetch-model.mjs` needs network at build/CI time (not at user runtime). CI must allow the HF download or pre-seed `models/`.
4. `engagementScore` is currently `likes + comments`; `performanceScore`/`brandFitScore` stay null until a scoring policy is defined (later phase).

---

## Execution handoff

Phase 3 (Context Pack: assemble brand + platform + similar approved/rejected + global frameworks + citations into `ContentContextPack`, served by `ContentMemoryService` over HTTP and via workflow nodes) gets its own plan once Phases 1–2 land. Phase 3 also folds embeddings into `knowledge_documents`/`knowledge_chunks` and upgrades the Phase 1 lexical doc search to semantic ranking behind the same `search()` surface.
