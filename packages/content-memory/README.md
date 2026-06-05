# Content Memory

`@anubis/content-memory` is the internal, brand-scoped content-memory library for the
Anubis backend. It provides a first-class **brand workspace** entity, scoped knowledge and
similarity retrieval, local offline embeddings, an AI-ready **context pack**, an
experience/feedback loop, and deterministic output validators with run tracing.

It has **no HTTP server, no MCP server, and no standalone binary**. `@anubis/conversation`
imports it directly, instantiates its repos/services against the shared `anubis.db` handle,
and the backend exposes the HTTP API.

> Design reference: `docs/superpowers/specs/2026-06-05-scoped-content-memory-design.md`
> (reconciled design) and the phase plans under `docs/superpowers/plans/`.

## Where it sits

```
@anubis/conversation  ──one-way──▶  @anubis/content-memory  ──▶  better-sqlite3 (type-only) + @anubis/shared
       │                                     ▲
   ConversationStack                  owns SQL migrations 008/009/011/012/013/014/015,
   (instantiates repos                exported as CONTENT_MEMORY_MIGRATIONS and spliced
    + services, runs                  into conversation's migration runner
    migrations)
```

The dependency is **strictly one-way**: `content-memory` never imports `conversation`
(that would create a cycle). It types the database handle via `better-sqlite3` directly
(`src/db/types.ts`), so production passes in the live handle created by `conversation`.

## Install / build

From the repository root:

```bash
pnpm install
pnpm --filter @anubis/content-memory build       # tsc + copies *.sql into dist/
pnpm --filter @anubis/content-memory typecheck
```

Build order is load-bearing: **content-memory builds before conversation** (wired into the
root `build` and `pretest` scripts).

## Naming note

The brand entity table is `brand_workspaces` and classes are `BrandWorkspace*`, but to avoid
colliding with the repo's other "workspace" concepts (filesystem `workspacePath`, ai-agent
`workspaceId`) the code field stays `workspaceId`, the scope value stays `'workspace'`, and
the well-known default brand is `DEFAULT_WORKSPACE_ID = 'default-workspace'`.

## Data model & migration ownership

All tables live in the single shared `anubis.db`. The global migration sequence is co-owned;
ownership is fixed so the two packages never collide on a version number:

| Version | File | Owner | Purpose |
|--------:|------|-------|---------|
| 008 | `008_brand_workspaces.sql` | content-memory | brand entity + seeded `default-workspace` |
| 009 | `009_knowledge_documents.sql` | content-memory | scoped knowledge store (scope/platform/sourceType) |
| 010 | `010_competitors_workspace.sql` | **conversation** | `ALTER competitors ADD workspace_id` + backfill (runs after 008) |
| 011 | `011_content_similarity_items.sql` | content-memory | similarity store (embedding BLOB) |
| 012 | `012_knowledge_documents_embedding.sql` | content-memory | document embedding column (semantic search) |
| 013 | `013_content_context_packs.sql` | content-memory | persisted context packs |
| 014 | `014_experience_memories.sql` | content-memory | experience/feedback memories |
| 015 | `015_agent_runs.sql` | content-memory | agent run traces |

Rules:
- content-memory owns 008/009/011/012/013/014/015 and exports them as
  `CONTENT_MEMORY_MIGRATIONS`. Future content tables must pick unused numbers (next free: 16+).
- conversation owns 010 because it `ALTER`s its own `competitors` table. Cross-package
  `ALTER` is always owned by the package that owns the table.
- Correct apply order is guaranteed by `runMigrations` sorting on `version`, not array order.

`competitors.workspace_id` is nullable at the DB level (SQLite `ALTER ... ADD ... REFERENCES`
under `foreign_keys=ON` requires a NULL default); non-null is enforced in the app layer (the
repo insert defaults to `DEFAULT_WORKSPACE_ID`).

## Embeddings (local, offline-first, bundled)

- **Model:** `Xenova/all-MiniLM-L6-v2` (384-dim, quantized) via `@xenova/transformers`,
  loaded **lazily** on first `embed()` (`src/embedding/xenova-embedder.ts`).
- **Storage:** vectors as Float32 **BLOB** (`toBlob`/`fromBlob`); ranking is **brute-force
  cosine in JS** over the scoped candidate set (`src/embedding/vector.ts`).
- **Delivery:** the model is **vendored at build time** into `packages/content-memory/models/`
  (gitignored) and bundled into the packaged app via electron-builder `extraResources`. At
  runtime `XenovaEmbedder` is constructed with `{ cacheDir: bundledModelCacheDir(),
  allowRemoteModels: false }` → **no network at user runtime**.

Vendor the model (network at build time only) before running the real-model test or a packaged build:

```bash
pnpm --filter @anubis/content-memory exec node ./scripts/fetch-model.mjs
```

> `@xenova/transformers` pulls native deps (`onnxruntime-node`, `sharp` + libvips). They are
> listed in the root `pnpm.onlyBuiltDependencies` so their build scripts run on install.

## Retrieval rules (scope before rank)

The core invariant for **both** stores: scope + platform filtering happens in SQL, **before**
ranking. The two stores have different scope rules — keep them separate.

**Knowledge documents** (`knowledge_documents`)
- Scope: `workspace_id = :workspaceId OR scope = 'global'` (global knowledge is shared).
- Platform: `platform IS NULL OR platform = :platform OR platform = 'general'`.
- Status: `'active'` only.
- Ranking: lexical (`search`) or semantic cosine over the embedding (`searchSemantic`).

**Similarity items** (`content_similarity_items`)
- Scope: `workspace_id = :workspaceId` **only** — never global. Cross-workspace retrieval is
  forbidden even at high semantic similarity.
- Platform: exact `platform = :platform` (no `general` fallback).
- Ranking: cosine, descending.
- **Rejected-content routing (critical):** approved/own posts, competitor posts, and
  **rejected** posts are fetched as *separate* queries into *distinct* context-pack buckets.
  Rejected examples are routed to "patterns to avoid" and are **never** returned in the
  approved/positive bucket. (See the §22.4 test in `tests/context-pack-service.test.ts`.)

## Public API

Import everything from the package root (`@anubis/content-memory`).

**Types / constants** — `Scope`, `Platform`/`PLATFORMS`, `SourceType`, `DocumentStatus`,
`ContentType`/`CONTENT_TYPES`, `ApprovalStatus`/`APPROVAL_STATUSES`, `ExperienceType`,
`Severity`, `MemoryStatus`, `DEFAULT_WORKSPACE_ID`.

**Migrations** — `CONTENT_MEMORY_MIGRATIONS`, `Migration`, `Db`.

**Repos** — `BrandWorkspacesRepo`, `KnowledgeDocumentsRepo` (`search` / `searchSemantic`),
`ContentSimilarityItemsRepo`, `ContentContextPacksRepo`, `ExperienceMemoriesRepo`,
`AgentRunsRepo`.

**Services**
- `BrandWorkspacesService` — create/get/list brands (UUID generation).
- `SimilarityIngestionService` — embed + upsert a similarity item (`normalizeSimilarityText`).
- `KnowledgeIngestionService` — embed + store a knowledge document.
- `ContextPackService` — assemble a `ContentContextPack` (brand context, platform context,
  separated approved/competitor/rejected buckets, frameworks, workspace rules, recalled
  experience, citations, final instruction). Takes an **optional** `experience` dep.
- `ContentMemoryService` — `buildForContentTask` (orchestrate + persist a pack) and `getPack`.
- `ExperienceIndexService` — `recordCandidate`, `saveFeedback`, `promote`, `deprecate`,
  `recallActive`.
- `ValidationService` + four validators: `WorkspaceLeakageValidator` (critical),
  `BrandRuleValidator` (high), `PlatformRuleValidator` (medium), `RepeatedMistakeValidator`
  (high). `forbiddenPhraseViolations` is the shared heuristic. **The validators are
  deterministic heuristics**, meant to catch obvious mistakes, not replace an LLM judge.
- `AgentRunService` — `saveRun` (full trace: retrieved id arrays, `contextPackId`,
  `validationStatus`).

### Example

```ts
import {
  BrandWorkspacesService, BrandWorkspacesRepo,
  ContextPackService, ContentMemoryService, ContentContextPacksRepo,
  KnowledgeDocumentsRepo, ContentSimilarityItemsRepo,
  ExperienceIndexService, ExperienceMemoriesRepo,
  ValidationService, WorkspaceLeakageValidator, BrandRuleValidator,
  PlatformRuleValidator, RepeatedMistakeValidator,
  XenovaEmbedder, bundledModelCacheDir,
} from '@anubis/content-memory'

// `db` is the shared better-sqlite3 handle (migrations already applied).
const embedder = new XenovaEmbedder({ cacheDir: bundledModelCacheDir(), allowRemoteModels: false })
const brands = new BrandWorkspacesRepo(db)
const experience = new ExperienceIndexService(new ExperienceMemoriesRepo(db))

const contextPack = new ContextPackService({
  brands,
  docs: new KnowledgeDocumentsRepo(db),
  items: new ContentSimilarityItemsRepo(db),
  embedder,
  experience,
})
const contentMemory = new ContentMemoryService({ contextPack, packs: new ContentContextPacksRepo(db) })

const { pack, packId } = await contentMemory.buildForContentTask({
  workspaceId: 'default-workspace', platform: 'instagram',
  taskType: 'generate_content', query: 'gentle skincare', objective: 'Generate a post',
})

const validation = new ValidationService([
  new WorkspaceLeakageValidator(brands),
  new BrandRuleValidator(),
  new PlatformRuleValidator(),
  new RepeatedMistakeValidator(experience),
])
const result = await validation.validate({
  workspaceId: 'default-workspace', platform: 'instagram', contextPack: pack, output: '…',
})
```

## ConversationStack

`@anubis/conversation`'s `createConversationService` exposes these on `ConversationStack`:

| Field | Type |
|-------|------|
| `brandWorkspaces` | `BrandWorkspacesService` |
| `knowledgeDocuments` | `KnowledgeDocumentsRepo` |
| `similarityItems` | `ContentSimilarityItemsRepo` |
| `similarityIngestion` | `SimilarityIngestionService` |
| `capturedPostsSimilarity` | `CapturedPostsSimilarityIngestor` (conversation-owned) |
| `contentMemory` | `ContentMemoryService` |
| `experience` | `ExperienceIndexService` |
| `validation` | `ValidationService` (4 validators) |
| `agentRuns` | `AgentRunService` |

## HTTP API (backend)

Exposed by `@anubis/backend` under `/content-memory` (`packages/backend/src/content-memory.ts`),
all bodies Zod-validated (`.strict()`):

| Method & path | Purpose |
|---------------|---------|
| `POST /content-memory/context-pack` | Build + persist a `ContentContextPack` for a brand/platform task. Returns `{ packId, pack }`. |
| `POST /content-memory/feedback` | Persist reviewer feedback as a candidate experience memory (good → no-op by default). |
| `POST /content-memory/memories/:id/promote` | Promote a candidate memory to `active`. |
| `POST /content-memory/validate` | Load a persisted pack by `packId` and validate an `output` (404 if pack not found). |
| `POST /content-memory/runs` | Persist an `agent_runs` trace (201). |

## Testing

```bash
pnpm vitest run packages/content-memory
```

- Logic/ranking tests use a deterministic `FakeEmbedder` (`tests/helpers/fake-embedder.ts`) —
  no model download, fully offline.
- The real `XenovaEmbedder` has a single env-gated smoke test:

  ```bash
  # vendor the model first (see "Embeddings"), then:
  RUN_MODEL_TESTS=1 pnpm vitest run packages/content-memory/tests/embedding/xenova-embedder.test.ts
  # PowerShell: $env:RUN_MODEL_TESTS=1; npx vitest run packages/content-memory/tests/embedding/xenova-embedder.test.ts
  ```

The defining guarantees have dedicated tests that must pass exactly as written:
cross-workspace isolation (`tests/knowledge-documents-repo.test.ts`), rejected-content
separation (`tests/context-pack-service.test.ts`), and output-layer leakage
(`tests/validators/workspace-leakage-validator.test.ts`).

## Conventions

- ESM, `NodeNext`, `verbatimModuleSyntax` — internal imports use explicit `.js` extensions.
- Raw-SQL migrations + repo pattern (no ORM); `Row` interfaces mirror snake_case columns,
  mappers convert to camelCase domain types.
- JSON array fields (tone/audience/offers/constraints/tags/topics/entities) are stored as
  TEXT and parsed defensively.

## Not in scope (follow-on work)

`knowledge_chunks` sub-document granularity, framework sub-taxonomy (hooks/CTA/structures),
`campaignContext`, confidence/reinforcement scoring, LLM-judge validators, and the workflow
nodes (`Retrieval`/`ContextBuilder`/`lessonWriter`/`lessonReader`/validators) + durable
rejection→regenerate loop. The nodes will call the services built here once the durable
engine lands.
