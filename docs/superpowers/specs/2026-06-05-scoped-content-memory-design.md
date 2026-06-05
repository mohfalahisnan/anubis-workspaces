# Design: Scoped Content Memory (Anubis-Reconciled)

Date: 2026-06-05
Status: **Design approved (brainstorming) — spec WIP, implementation not started**
Branch at time of writing: `codex/json-transformer-media-arrays`

This document adapts the external **Anubis Scoped Content Memory Spec**
(`anubis-scoped-content-memory-spec.md`) to the *actual* Anubis codebase. The
original spec was written as if a similarity/knowledge layer already existed and
"just" needed scoping. In reality almost none of it is built. This doc records
what exists, the decisions taken to reconcile the spec with reality, and the
target architecture/data-model so the next session can resume without
re-deriving anything.

Read the original spec for the full conceptual model (scopes, conflict
resolution, ranking, context-pack shape, validators). **This doc overrides the
original wherever they conflict.**

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
  topological executor; being upgraded to a durable re-entrant scheduler per
  `docs/superpowers/specs/2026-06-05-content-workflow-engine-design.md`. UI nodes
  `SearchNode` ("Anubis Context Retrieval — similarity search + context pack")
  and `ContextBuilderNode` ("AI Context Builder") exist as **demo cards only** —
  no runtime executor, no backend.
- **AI agents**: `packages/ai-agent` — Codex/Claude agents; skills/MCP (incl.
  `anubis-extractor` for OCR/transcribe) materialised into the agent workspace.
  Has its own `workspaceId` string (defaults to `'default'`) scoping agent
  sessions/sandbox.
- **Workspaces (existing)**: conversations carry a filesystem `workspacePath`;
  `known_workspaces` (`007`) tracks paths + last-used. This is a *working
  directory*, NOT a brand/client entity.

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
| Scope key | **New first-class Brand/Workspace entity** (`content_workspaces`, UUID) |
| Packaging | **One `@anubis/content-memory` package** (logical modules inside); migrations registered into the existing `conversation` runner; one `anubis.db` |
| Embeddings | **Local model** (e.g. `all-MiniLM-L6-v2`, 384-dim, via `@xenova/transformers`) in the backend process; vectors stored as Float32 **BLOB**; **brute-force cosine in JS** |
| Brand ↔ data | **Brand owns its competitor set** — add `workspace_id` FK to `competitors`; `captured_posts` inherit scope via their competitor |
| Context pack | **Service-first** — `ContentMemoryService` is the source of truth; exposed over HTTP *and* consumed by workflow nodes |
| Experience index | **Unified** — the planned `lessonWriter`/`lessonReader` nodes write to `experience_memories` (no separate `workflow_lessons` table) |
| MVP scopes | `global | workspace` (platform = filter dimension, not a scope) |

---

## 3. Package layout

`@anubis/content-memory` is a logical package: it owns types, repos, and
services, but its tables live in the shared `anubis.db` and its migrations are
registered into `packages/conversation/src/db/migrations/index.ts` so foreign
keys to `content_workspaces` and `competitors` are enforceable.

```
packages/content-memory/src/
  types.ts            # core entities, scopes, contracts (spec §16 interfaces)
  db/
    migrations/       # SQL files contributed to the conversation runner
    repositories/     # workspaces, knowledge-docs, chunks, similarity-items,
                      # experience-memories, agent-runs, context-packs
  embedding/          # local model loader + embed(text) + cosine()
  ingestion/          # captured_posts -> content_similarity_items (+ embed)
  retrieval/          # scope/platform filter -> rank (spec §10-12)
  context-pack/       # ContextPackService (spec §13-14)
  similarity/         # ContentSimilarityService (spec §8.6)
  experience/         # ExperienceIndexService (spec §8.7)
  validators/         # OutputValidator implementations (spec §17)
  service.ts          # ContentMemoryService.buildForContentTask() (spec §15)
  index.ts            # public API
```

The original spec's 8-package split collapses into these folders. The
`embeddingId` indirection collapses too — with brute-force cosine the vector is a
column on the chunk/item; no separate embeddings table.

---

## 4. Data model (all tables in `anubis.db`)

New migrations registered after `007`. Suggested ordering:

```
008_content_workspaces.sql        NEW   the brand entity
009_competitors_workspace.sql     ALTER add workspace_id FK + default-brand migration
010_knowledge_documents.sql       NEW
011_knowledge_chunks.sql          NEW   (embedding BLOB column)
012_content_similarity_items.sql  NEW   (embedding BLOB column)
013_experience_memories.sql       NEW
014_agent_runs.sql                NEW   (content-task scoped; != existing agent_sessions)
015_content_context_packs.sql     NEW
```

### 4.1 `content_workspaces` (the brand entity — NET NEW)

Source for the context pack's `brandContext` (spec §13).

```ts
type ContentWorkspace = {
  id: string                  // UUID
  name: string
  brandSummary: string | null
  toneOfVoice: string[]       // stored as JSON
  audience: string[]
  offers: string[]
  constraints: string[]       // hard "must avoid" rules
  status: "active" | "archived"
  createdAt: number           // epoch ms
  updatedAt: number
}
```

### 4.2 `competitors` — ALTER

Add `workspace_id TEXT` FK → `content_workspaces.id`. Migration auto-creates one
**"Default Workspace"** brand and assigns all existing competitor rows to it.
`captured_posts` need no column — their scope is `competitor.workspace_id`.

### 4.3 `content_similarity_items` (NET NEW — seeded from captured_posts)

Mirrors original spec §9.3, plus the embedding inline.

```ts
type ContentSimilarityItem = {
  id: string
  workspaceId: string         // required — always workspace-scoped
  platform: string            // 'instagram' for now
  contentId: string           // e.g. captured_posts.id when ingested
  contentType:
    | "competitor_post" | "own_post" | "approved_post"
    | "rejected_post" | "generated_draft"
  caption: string | null
  transcript: string | null
  ocrText: string | null
  visualDescription: string | null
  normalizedText: string
  embedding: Buffer           // Float32 BLOB (was embeddingId)
  performanceScore: number | null
  engagementScore: number | null
  brandFitScore: number | null
  approvalStatus: "approved" | "rejected" | "needs_review" | null
  rejectionReason: string | null
  createdAt: number
  updatedAt: number
}
```

Rule preserved: **no cross-workspace similarity retrieval.**

### 4.4 `knowledge_documents` + `knowledge_chunks` (NET NEW)

Per original spec §9.1/§9.2, with two changes:
- `scope` is `'global' | 'workspace'`; `workspaceId` null iff global.
- `knowledge_chunks` carries `embedding Buffer` (Float32 BLOB) instead of
  `embeddingId`. Scope/workspaceId/platform/sourceType duplicated on chunks for
  safe, fast retrieval (spec §9.2 note retained).

### 4.5 `experience_memories` (NET NEW — also the lessons write-target)

Per original spec §9.4 (scope, type, problem/cause/correction, severity,
lifecycle `candidate→active→reinforced→deprecated/rejected`, usage/confidence
counters). The engine design's `lessonWriter`/`lessonReader` nodes write/read
here instead of a separate `workflow_lessons` table:
- `lessonWriter` → `append({ type: 'mistake'|'lesson', ... , status: 'candidate' })`
- `lessonReader` → `recentForWorkspace(workspaceId, limit)` filtered to `active`.

### 4.6 `agent_runs` + `content_context_packs` (NET NEW)

Per original spec §9.5/§9.6. Note: an `agent_sessions` table already exists for
conversations — these are distinct, content-task-scoped records and must not be
conflated.

---

## 5. Embeddings

- Model loads once in the backend (Node child) — default `all-MiniLM-L6-v2`
  (384-dim) via `@xenova/transformers`. No API key, offline, private.
- `embed(text): Float32Array` on ingest and on query.
- Store as Float32 BLOB. Retrieval does **brute-force cosine in JS** over the
  scoped candidate set (a single workspace's items: hundreds–low thousands →
  sub-ms). Revisit `sqlite-vec` only if a workspace's corpus outgrows this.
- Embedding lives behind the `embedding/` module so the provider can be swapped
  without touching retrieval.

---

## 6. Retrieval (unchanged in principle — spec §10-12)

The core invariant holds: **scope + platform filter BEFORE ranking.**

```sql
WHERE (workspace_id = :workspaceId OR workspace_id IS NULL)   -- scope
  AND (platform IS NULL OR platform = :platform OR platform = 'general')
  AND status = 'active'                                        -- unless override
```

Then rank with the weighted formula (semantic + keyword + workspace/platform/
sourceType boosts − deprecated/rejected penalties). **Rejected content is never a
positive example** — it routes into "patterns to avoid."

`ContentMemoryService.buildForContentTask()` (spec §15) orchestrates: validate
workspace access → enforce scope → retrieve workspace KB → global KB → platform
context → similar content (approved/competitor/rejected, kept separate) →
experience memories → assemble `ContentContextPack` → leakage validation →
return. Exposed as `POST /content-memory/context-pack`; the `Retrieval` /
`ContextBuilder` workflow nodes call the same service.

---

## 7. Validators (spec §17)

MVP four: `WorkspaceLeakageValidator`, `BrandRuleValidator`,
`RepeatedMistakeValidator`, `PlatformRuleValidator`. With the brand entity in
place, leakage is concrete: assert every citation's `workspaceId` is the active
brand or global. Wire validators into the workflow before the human-review gate
(reuses the engine design's `humanReview` / `branchDecision` nodes).

---

## 8. Revised phasing (original spec §21 → repo)

1. **Foundation** — `@anubis/content-memory` skeleton + `content_workspaces` +
   `competitors.workspace_id` migration (+ default brand) + cross-workspace
   isolation tests (spec §22.1/§22.2).
2. **Ingest + similarity** — local embedder; ingest `captured_posts` →
   `content_similarity_items`; scoped vector retrieval; platform filter test
   (§22.3).
3. **Context pack** — `ContentMemoryService` + HTTP route; separate
   approved/rejected sections + citations; rejected-routing test (§22.4).
4. **Experience** — `experience_memories` + lesson nodes writing to it; recall
   active memories into the context pack.
5. **Validators + wiring** — 4 MVP validators; connect to workflow nodes /
   human-review gate; persist `agent_runs` + `content_context_packs`.

---

## 9. Open items to finalise during implementation

1. **Default-brand migration** — auto-create one "Default Workspace" and assign
   all existing competitors; confirm name/id strategy.
2. **Agent-run scoping** — Brand is NOT tied 1:1 to ai-agent `workspaceId`; the
   brand id is passed *into* agent runs as a parameter (loose coupling). Confirm
   this is acceptable long-term.
3. **Embedding model + dimension** — confirm `all-MiniLM-L6-v2` (384) vs an
   alternative; pin model version; decide first-run download UX.
4. **Global knowledge curation** — who/what seeds the global frameworks
   (spec §6.1). MVP: manual import.
5. **Platform** — enum retained but only `instagram` populated until other
   crawlers exist.
6. **Lesson node ↔ experience memory** — exact mapping of node output fields to
   `experience_memories` columns and the candidate→active promotion UX.
7. **Migration ownership** — confirm the mechanics of a separate package
   contributing SQL into `conversation`'s migration runner.

---

## 10. Next session — start here

1. Re-read this doc and the engine design
   (`2026-06-05-content-workflow-engine-design.md`) — they share the workflow
   surface.
2. Resolve the quick items in §9.
3. Invoke `superpowers:writing-plans` to turn this into a phased implementation
   plan, then `superpowers:test-driven-development` per unit (start with the
   isolation tests — they are the MVP's defining guarantee).
4. Build foundation first (package + brand entity + scoped retrieval), then
   ingestion/embeddings, then context pack, then experience, then validators.
