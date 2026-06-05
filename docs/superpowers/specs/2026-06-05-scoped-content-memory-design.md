# Design: Scoped Content Memory (Anubis-Reconciled)

Date: 2026-06-05
Status: **Design approved (brainstorming) — spec WIP, implementation not started**
Branch at time of writing: `codex/json-transformer-media-arrays`
Revision: r2 (incorporates review — brand naming, migration ownership, retrieval
split, embedding delivery, fixed doc references)

This document adapts the external **Anubis Scoped Content Memory Spec**
(`anubis-scoped-content-memory-spec.md`) to the *actual* Anubis codebase. The
original spec was written as if a similarity/knowledge layer already existed and
"just" needed scoping. In reality almost none of it is built. This doc records
what exists, the decisions taken to reconcile the spec with reality, and the
target architecture/data-model so the next session can resume without
re-deriving anything.

Read the original spec for the full conceptual model (scopes, conflict
resolution, ranking, context-pack shape, validators). **This doc overrides the
original wherever they conflict.** The phased plans
(`docs/superpowers/plans/2026-06-05-scoped-content-memory-phase{1,2}.md`) are the
authoritative source for file-level details; where this doc and a plan differ,
the plan wins.

---

## 1. Current reality (what actually exists)

Inventory from the code (paths relative to repo root).

- **Storage**: SQLite via `better-sqlite3`, WAL, `foreign_keys=ON`. Raw SQL
  migrations (no ORM) in `packages/conversation/src/db/migrations/`, registered
  in `migrations/index.ts` (currently up to `007_known_workspaces.sql`). Repo
  pattern in `packages/conversation/src/db/repositories/`. One physical DB
  (`anubis.db`).
- **Content data — implemented**:
  - `competitors` (`002_competitors.sql`) — handle, displayName, niche, tint,
    followers, avgLikes, postCount, bio, level (`black|green|yellow|red`), soft
    delete. Service + repo + routes (`GET/POST/PATCH/DELETE /competitors`).
  - `captured_posts` (`003_captured_posts.sql`) — competitorId FK, caption,
    likes, comments, postedAt, mediaKind (`image|video|carousel`), mediaUrl,
    carouselCount, `raw` JSON. Routes `GET /posts`, `PATCH/DELETE /posts/:id`,
    `POST /captures/competitors/:id` (scrape IG via `@anubis/research-crawler`).
- **Workflow engine**: `packages/workflow-runtime` — currently a one-shot
  topological executor (base design: `2026-06-04-workflow-system-design.md`). A
  durable re-entrant scheduler upgrade is designed in a **separate doc that is
  not on this branch's working tree** (it lives only in commit `058a0e7`); treat
  it as pending, not a hard dependency of this work. UI nodes `SearchNode`
  ("Anubis Context Retrieval — similarity search + context pack") and
  `ContextBuilderNode` ("AI Context Builder") exist as **demo cards only** — no
  runtime executor, no backend.
- **AI agents**: `packages/ai-agent` — Codex/Claude agents; skills/MCP (incl.
  `anubis-extractor` for OCR/transcribe) materialised into the agent workspace.
  Has its own `workspaceId` string (defaults to `'default'`) scoping agent
  sessions/sandbox.
- **Workspaces (existing)**: conversations carry a filesystem `workspacePath`;
  `known_workspaces` (`007`) tracks paths + last-used. This is a *working
  directory*, NOT a brand/client entity.

> **Naming note.** "Workspace" is already overloaded in this repo (the
> filesystem `workspacePath` and the ai-agent `workspaceId`). To avoid a third
> colliding concept, the brand/client entity introduced here is the
> **`brand_workspaces`** table. The scope key field in code stays `workspaceId`
> and the scope value stays `'workspace'` (matching the original spec's field
> names); only the table/entity name is qualified as a *brand* workspace.

### What the original spec assumes but does NOT exist
Embeddings (no provider, no vector store), `knowledge_documents` /
`knowledge_chunks`, `scope`/`platform`/`sourceType` fields, retrieval engine,
context-pack service, validators, any persisted "similarity index" (the UI stars
in `content.tsx` are ephemeral React state). The skill-managed markdown
"similarity library" is out of scope as a backend source.

---

## 2. Locked decisions

| Dimension | Decision |
|---|---|
| Starting point | **Greenfield** backend; ingest from `captured_posts` as seed data (do not mutate crawler tables to carry memory) |
| Scope key | New first-class **Brand workspace** entity (`brand_workspaces`, UUID); code field stays `workspaceId`, scope value stays `'workspace'` |
| Packaging | **One `@anubis/content-memory` package** (logical modules inside); migrations registered into the existing `conversation` runner; one `anubis.db` |
| Embeddings | **Local model** (`all-MiniLM-L6-v2`, 384-dim, via `@xenova/transformers`) in the backend process; vectors stored as Float32 **BLOB**; **brute-force cosine in JS** |
| Embedding delivery | **Bundle the quantized model in the installer** (electron-builder `extraResources`); `allowRemoteModels = false` at runtime → offline from first launch |
| Brand ↔ data | **Brand workspace owns its competitor set** — `workspace_id` FK on `competitors`; posts inherit scope via competitor |
| Context pack | **Service-first** — `ContentMemoryService` is truth; exposed over HTTP *and* consumed by workflow nodes |
| Experience | **Unified** — the planned `lessonWriter`/`lessonReader` nodes write to `experience_memories` (no separate `workflow_lessons` table) |
| MVP scopes | `global | workspace` (platform = filter dimension, not a scope) |

---

## 3. Package layout & migration ownership

`@anubis/content-memory` is a logical package: it owns types, repos, and
services, plus the SQL migrations for the tables it owns. Its tables live in the
shared `anubis.db`, and its migrations are **exported** as
`CONTENT_MEMORY_MIGRATIONS` and spliced into `conversation`'s migration runner.
Dependency direction is **one-way**: `conversation → content-memory`.
`content-memory` depends only on `better-sqlite3` (type-only) and `@anubis/shared`
— never on `conversation` — so there is no cycle.

### Migration ownership (explicit)

The single global migration sequence is co-owned. Ownership is fixed as follows
so the two packages never collide on a version number:

| Version | File | Owner | Purpose |
|---|---|---|---|
| 001–007 | existing | conversation | base schema |
| 008 | `008_brand_workspaces.sql` | **content-memory** | brand workspace entity + default brand seed |
| 009 | `009_knowledge_documents.sql` | **content-memory** | scoped knowledge store |
| 010 | `010_competitors_workspace.sql` | **conversation** | `ALTER competitors ADD workspace_id` + backfill (must run *after* 008) |
| 011 | `011_content_similarity_items.sql` | **content-memory** | similarity store (embedding BLOB) |
| 012+ | (future) | per-phase | experience_memories, agent_runs, context_packs |

Rules:
- content-memory owns 008, 009, 011 (and future content tables); it must pick
  unused version numbers and never reuse a conversation-owned one.
- conversation owns 010 because it ALTERs *its own* `competitors` table; 010
  references `brand_workspaces` (created by 008), and correct apply order is
  guaranteed by `runMigrations` sorting on version, not array position.
- A migration may only `CREATE` tables its package owns; cross-package `ALTER`
  (like 010 touching `competitors`) is owned by the package that owns the table
  being altered.

### Module folders

```
packages/content-memory/src/
  types.ts            # Scope, Platform, ContentType, ApprovalStatus, DEFAULT_WORKSPACE_ID
  db/
    types.ts          # Db, Migration (local, structural — no conversation import)
    migrations/       # 008, 009, 011 (+ index → CONTENT_MEMORY_MIGRATIONS)
    repositories/     # brand-workspaces, knowledge-documents, content-similarity-items, …
  embedding/          # Embedder iface, XenovaEmbedder (bundled model), vector utils
  similarity/         # SimilarityIngestionService
  brand-workspaces/   # BrandWorkspacesService
  context-pack/        # ContextPackService (Phase 3)
  experience/         # ExperienceIndexService (Phase 4)
  validators/         # OutputValidator implementations (Phase 5)
  service.ts          # ContentMemoryService.buildForContentTask() (Phase 3)
  index.ts            # public API
```

The original spec's 8-package split collapses into these folders. The
`embeddingId` indirection collapses too — with brute-force cosine the vector is a
column on the chunk/item; no separate embeddings table.

---

## 4. Data model (all tables in `anubis.db`)

See §3 for the version/owner of each migration.

### 4.1 `brand_workspaces` (the brand entity — NET NEW, migration 008)

Source for the context pack's `brandContext` (spec §13).

```ts
type BrandWorkspace = {
  id: string                  // UUID (or 'default-workspace' for the seeded brand)
  name: string
  brandSummary: string | null
  toneOfVoice: string[]       // stored as JSON
  audience: string[]
  offers: string[]
  constraints: string[]       // hard "must avoid" rules
  status: 'active' | 'archived'
  createdAt: number           // epoch ms
  updatedAt: number
}
```

Migration 008 also seeds a well-known default brand
(`id = 'default-workspace'`, `name = 'Default Workspace'`) that migration 010
backfills existing competitors onto. Repo/service: `BrandWorkspacesRepo`,
`BrandWorkspacesService`.

### 4.2 `competitors` — ALTER (migration 010, owned by conversation)

Add `workspace_id TEXT REFERENCES brand_workspaces(id)` (nullable with NULL
default — SQLite permits the REFERENCES clause under `foreign_keys=ON` only with
a NULL default). The migration backfills all rows to `'default-workspace'`.
`captured_posts` need no column — their scope is `competitor.workspace_id`.
Non-null is enforced in the app layer (repo insert defaults to
`DEFAULT_WORKSPACE_ID`).

### 4.3 `content_similarity_items` (NET NEW, migration 011 — seeded from captured_posts)

Mirrors original spec §9.3, plus the embedding inline.

```ts
type ContentSimilarityItem = {
  id: string
  workspaceId: string         // required — always brand-scoped, never global
  platform: string            // 'instagram' for now
  contentId: string | null    // e.g. captured_posts.id when ingested (no FK — items outlive posts)
  contentType:
    | 'competitor_post' | 'own_post' | 'approved_post'
    | 'rejected_post' | 'generated_draft'
  caption: string | null
  transcript: string | null
  ocrText: string | null
  visualDescription: string | null
  normalizedText: string
  embedding: Float32Array      // Float32 BLOB at rest (was embeddingId)
  performanceScore: number | null
  engagementScore: number | null
  brandFitScore: number | null
  approvalStatus: 'approved' | 'rejected' | 'needs_review' | null
  rejectionReason: string | null
  createdAt: number
  updatedAt: number
}
```

Rule preserved: **no cross-workspace similarity retrieval.** Upsert key is
`(workspace_id, content_id)` so re-ingest updates in place.

### 4.4 `knowledge_documents` + `knowledge_chunks` (migration 009 + later)

Per original spec §9.1/§9.2, with two changes:
- `scope` is `'global' | 'workspace'`; `workspaceId` null iff global.
- `knowledge_chunks` carries `embedding` (Float32 BLOB) instead of
  `embeddingId`. Scope/workspaceId/platform/sourceType duplicated on chunks for
  safe, fast retrieval (spec §9.2 note retained).

Phase 1 ships `knowledge_documents` only, with **lexical** scoped search (proves
isolation). Phase 3 adds `knowledge_chunks` + embeddings and upgrades the doc
search to semantic ranking behind the same `search()` surface.

### 4.5 `experience_memories` (NET NEW — Phase 4, also the lessons write-target)

Per original spec §9.4 (scope, type, problem/cause/correction, severity,
lifecycle `candidate→active→reinforced→deprecated/rejected`, usage/confidence
counters). The engine design's `lessonWriter`/`lessonReader` nodes write/read
here instead of a separate `workflow_lessons` table.

### 4.6 `agent_runs` + `content_context_packs` (NET NEW — Phase 3/5)

Per original spec §9.5/§9.6. Note: an `agent_sessions` table already exists for
conversations — these are distinct, content-task-scoped records and must not be
conflated.

---

## 5. Embeddings (decided)

- **Model**: `Xenova/all-MiniLM-L6-v2` (384-dim), quantized, via
  `@xenova/transformers`, loaded **lazily** in the backend process.
- **Delivery — bundled, offline-first**:
  - The quantized model is vendored into `packages/content-memory/models/`
    (gitignored; fetched at build/CI time by a `fetch-model` script — network at
    *build* time only).
  - electron-builder `extraResources` copies `models/` into the packaged app.
  - `XenovaEmbedder` accepts `{ cacheDir, allowRemoteModels }`; at runtime it
    points `@xenova/transformers` `env.cacheDir` at the bundled model dir and
    sets `allowRemoteModels = false` → **no network at user runtime**.
  - In dev, the same `fetch-model` step warms `models/`; tests never touch the
    model (they use a deterministic `FakeEmbedder`), and the real model has one
    env-gated smoke test (`RUN_MODEL_TESTS=1`).
- **Storage/search**: vectors as Float32 BLOB; **brute-force cosine in JS** over
  the scoped candidate set (a single brand's items: hundreds–low thousands →
  sub-ms). Revisit `sqlite-vec` only if a brand's corpus outgrows this.
- The provider sits behind the `embedding/` module so it can be swapped without
  touching retrieval.

---

## 6. Retrieval rules (per store)

The core invariant holds for both stores: **scope + platform filter happens in
SQL, BEFORE ranking** (original spec §11). But the two stores have *different*
scope and ranking rules — keep them separate.

### 6.1 Knowledge documents / chunks (`knowledge_*`)

- **Scope filter**: `workspace_id = :workspaceId OR workspace_id IS NULL`
  (global knowledge is shared across brands).
- **Platform filter**: `platform IS NULL OR platform = :platform OR platform = 'general'`.
- **Status filter**: `status = 'active'` (deprecated/archived excluded unless
  explicitly requested).
- **Ranking**: lexical now (Phase 1); semantic (cosine over chunk embeddings)
  blended with keyword + the spec §12 boosts (workspace/platform/sourceType/
  recency) in Phase 3. `deprecatedPenalty` applies if ever surfaced.

### 6.2 Similarity items (`content_similarity_items`)

- **Scope filter**: `workspace_id = :workspaceId` **only** — NEVER global. There
  is no global similarity content; cross-workspace retrieval is forbidden even at
  high semantic similarity.
- **Platform filter**: exact `platform = :platform` (similarity items are
  single-platform; no `general` fallback).
- **Ranking**: cosine(queryEmbedding, item.embedding) in JS, descending.
- **Rejected-content routing (critical, original spec §12/§14/§19):**
  - Approved/positive examples are fetched as a *separate query* —
    `contentType IN ('approved_post','own_post')` and/or
    `approvalStatus = 'approved'`. Competitor posts (`competitor_post`) are
    neutral references and may be fetched in their own bucket.
  - Rejected examples are fetched as a *separate query* —
    `contentType = 'rejected_post'` or `approvalStatus = 'rejected'` — and routed
    into the context pack's "patterns to avoid" section. They are **never**
    returned in the approved/positive bucket and never treated as targets.
  - If a single combined query is ever used, apply `rejectedPenalty` (spec §12)
    so rejected items cannot outrank positives — but the default is separate
    queries per bucket, which the repo's `contentTypes` / `approvalStatuses`
    filters already support.

`ContentMemoryService.buildForContentTask()` (Phase 3) orchestrates both stores:
validate brand access → enforce scope → retrieve brand KB + global KB (6.1) →
platform context → similar **approved** + **competitor** + **rejected** buckets
(6.2, kept separate) → experience memories → assemble `ContentContextPack` →
leakage validation → return. Exposed as `POST /content-memory/context-pack`; the
`Retrieval` / `ContextBuilder` workflow nodes call the same service.

---

## 7. Validators (spec §17)

MVP four: `WorkspaceLeakageValidator`, `BrandRuleValidator`,
`RepeatedMistakeValidator`, `PlatformRuleValidator`. With the brand entity in
place, leakage is concrete: assert every citation's `workspaceId` is the active
brand or global. Wire validators into the workflow before the human-review gate
(reuses the pending durable-engine's `humanReview` / `branchDecision` nodes).

---

## 8. Revised phasing (original spec §21 → repo)

1. **Foundation** — `@anubis/content-memory` skeleton + `brand_workspaces` +
   `competitors.workspace_id` migration (+ default brand) + cross-workspace
   isolation tests (spec §22.1/§22.2). *(Plan: phase1.)*
2. **Ingest + similarity** — bundled local embedder; ingest `captured_posts` →
   `content_similarity_items`; scoped vector retrieval; platform filter test
   (§22.3). *(Plan: phase2.)*
3. **Context pack** — `ContentMemoryService` + HTTP route; knowledge chunks +
   embeddings; separate approved/rejected buckets + citations; rejected-routing
   test (§22.4).
4. **Experience** — `experience_memories` + lesson nodes writing to it; recall
   active memories into the context pack.
5. **Validators + wiring** — 4 MVP validators; connect to workflow nodes /
   human-review gate; persist `agent_runs` + `content_context_packs`.

---

## 9. Open items to finalise during implementation

1. **Default-brand migration** — seeded as `'default-workspace'` /
   "Default Workspace" in migration 008; confirm this id/name is acceptable as
   the permanent well-known constant.
2. **Agent-run scoping** — Brand is NOT tied 1:1 to ai-agent `workspaceId`; the
   brand id is passed *into* agent runs as a parameter (loose coupling). Confirm
   acceptable long-term.
3. **Packaged model path resolution** — the one embedding wiring detail left:
   how `XenovaEmbedder` resolves the bundled `models/` dir in dev vs. packaged
   (electron-builder resources path). Validated at app-build time in Phase 2/3.
4. **Global knowledge curation** — who/what seeds the global frameworks
   (spec §6.1). MVP: manual import.
5. **Platform** — enum retained but only `instagram` populated until other
   crawlers exist.
6. **Lesson node ↔ experience memory** — exact field mapping and the
   candidate→active promotion UX (Phase 4).

> Resolved by this revision (no longer open): migration ownership (§3), the
> `content_workspaces` naming collision (→ `brand_workspaces`, §1 note),
> embedding delivery (§5).

---

## 10. Next session — start here

1. Re-read this doc. The base workflow engine is described in
   `2026-06-04-workflow-system-design.md`; the durable-scheduler upgrade is a
   separate, not-yet-landed design (see §1) — do not block content-memory on it.
2. Resolve the quick items in §9.
3. Phase 1 and Phase 2 plans already exist
   (`docs/superpowers/plans/2026-06-05-scoped-content-memory-phase{1,2}.md`).
   Execute them via `superpowers:subagent-driven-development`, then write the
   Phase 3 plan.
4. Build order is load-bearing (per CLAUDE.md): content-memory builds *before*
   conversation.
