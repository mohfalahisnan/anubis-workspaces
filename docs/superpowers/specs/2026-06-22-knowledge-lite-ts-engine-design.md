# Design: `@anubis/knowledge-lite` — in-backend TypeScript knowledge engine

- **Date:** 2026-06-22
- **Status:** Approved (design); ready for implementation planning
- **Supersedes:** the external `anubis-engine` Rust binary integration (`docs/adr/0001-engine-state-under-anubis-datadir.md`, `docs/adr/0002-knowledge-base-workdir-equals-workspace-root.md`)

## 1. Background & motivation

The app's "Knowledge Base" is currently driven by an **external `anubis-engine` Rust binary**: a full RAG-ish system (tantivy FTS + vector state + knowledge graph + entity extraction) that the user installs out-of-band and configures in Settings → External binaries (`engineBinaryPath`). The backend shells out to it via `spawnCliJson` from `packages/backend/src/knowledge-base.ts`, and pre-packs a "context pack" into agent prompts each turn.

This is over-engineered for the actual need: **index curated markdown knowledge and let the agent retrieve cited context on demand.** No vectors, no entity graph, no RAG pipeline.

A lighter engine already exists as a standalone Python plugin at `C:\Projects\anubis-lite` (`scripts/engine.py` + `engine_*` modules, standard-library only): it indexes markdown, searches with a tuned BM25 ranker, and returns line-cited excerpts. Rather than ship that Python plugin into each agent's workspace, we **port the engine to TypeScript and host it inside the backend**. The agent already receives the backend URL in its system prompt, so it can call the engine over HTTP on demand — no plugin, no Python runtime, no script staged into the workspace.

## 2. Goals / non-goals

**Goals**
- Port the anubis-lite engine to TypeScript as a self-contained package.
- Host it in the backend; expose it over the existing `/knowledge-base/*` HTTP routes.
- Make retrieval **agent-driven**: the agent searches and cites on demand; nothing is pre-injected.
- Preserve the tuned retrieval quality (faithful ranker port, verified by a ported benchmark).
- Retire the external Rust engine and the automatic context-pack injection.

**Non-goals (v1)**
- Knowledge graph (nodes/edges + HTML viewer) — deferred.
- Lessons scope (`learn` / `--lessons`) — deferred.
- Vector/semantic search — explicitly not wanted.
- Data migration from the old engine's indexes — fresh ingest instead.
- Browser agents (`gpt-web`/`qwen-web`) using the KB — they can't make HTTP calls (accepted gap).

## 3. Locked decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Agent ↔ engine interface | **Agent-driven over HTTP** — engine in backend, agent calls `/knowledge-base/*` on demand; nothing pre-injected |
| 2 | v1 feature scope | **Core + write ops**: `search`, `ingest` (+ lazy refresh), `save`/`update`/`delete`, `stats`/`documents` |
| 3 | Teardown | **Full swap**: retire Rust engine + automatic context-pack injection; repoint the KB search GUI to lite; park the graph page |
| 4 | Data location | **Workspace `knowledge/` markdown** (source of truth) + **per-project SQLite index under `dataDir`** (disposable) |
| 5 | Search fidelity | **Faithful port** of the BM25 + heading boost + phrase + proximity + confidence ranker; **benchmark ported as a parity test** |
| 6 | Code location | **New package `@anubis/knowledge-lite`** (pure engine); backend wraps it with HTTP + project path resolution |

## 4. Architecture & boundaries

Three layers, each with one job:

1. **`@anubis/knowledge-lite`** (new package, `packages/knowledge-lite`) — pure, framework-agnostic TS port of the Python engine. Programmatic API only; `better-sqlite3` for the disposable index. Knows nothing about projects, HTTP, or the app. Takes explicit `{ sourceRoot, dbPath }`.
2. **Backend** (`packages/backend/src/knowledge-base.ts`, rewritten) — owns per-project path resolution, instantiates the engine, exposes the reshaped `/knowledge-base/*` routes, retains the single-flight `withEngineLock` serialization for sqlite writes.
3. **Agent integration** — no code shipped to the agent. The `anubis-core` auto-inject skill's KB section is rewritten to the lite search/cite workflow; the always-on instruction extender ([`buildProjectBlock`](../../../packages/conversation/src/skills/inject.ts) already injects the live `backendUrl`) gains a short "search-before-answering-from-local-knowledge, cite source + line range" pointer.

**Known limitation:** browser agents (`gpt-web`/`qwen-web`) cannot `curl`, so the KB is unavailable to them — the same gap as any HTTP-backed capability.

## 5. Package internals

The package mirrors the Python modules, one focused TS unit each:

| TS unit | Ports from Python (`scripts/engine_*.py`) | Responsibility |
|---|---|---|
| `config.ts` | `engine_constants` | BM25 `K1`/`B`, `HEADING_BOOST`, `PROX_GAIN`, `SEARCH_POOL_*`, chunk token targets/max, confidence thresholds (`CONF_COVERAGE_MIN`, `CONF_SCORE_FLOOR`), `INDEX_VERSION`, schema SQL, scope constants |
| `chunking.ts` | `engine_index` (chunking parts) | `splitSections`, `paragraphBlocks`, `chunksForFile`, `estimateTokens`, `normalizeTerms` (stopword + sub-3-char drop), `titleFromText` |
| `index-store.ts` | `engine_index` (store parts) | sqlite schema (`documents`, `chunks`, `terms`), `buildIndex` with incremental content-hash reuse, `readChunksFromDb`, atomic tmp-file replace |
| `search.ts` | `engine_search` | `parseQuery` (quoted phrases + distinct terms), BM25 (`corpusStats`, `queryIdf`, `fetchCandidates`), `proximityFactor`, `containsPhrase`, `searchIndex`, line-cited result rendering + low-confidence note |
| `benchmark.ts` | `engine_search` (benchmark parts) | `benchmarkSelfTest`, `computeMetrics` (P@1, MRR, recall) — **test-only**, the parity gate |
| `fs.ts` | `engine_fs` (subset) | sha256 hashing, scan markdown files, utc timestamp. Project/path resolution stays in the backend; the package takes explicit roots |
| `index.ts` | (new public surface) | `createEngine({ sourceRoot, dbPath, config? })` → `{ ingest, search, save, update, delete, stats, listDocuments }` |

**Ranker details to preserve (faithful port):** BM25 with Lucene-variant non-negative IDF, per-term heading boost, phrase queries that keep the full candidate pool and verify contiguous adjacency against the re-read token stream, proximity factor = `coverage × tightness` over the smallest window covering distinct query terms, final score `bm25 × (1 + PROX_GAIN × proximity)`, normalized to top result, and a "Low confidence" note when top coverage < `CONF_COVERAGE_MIN` or top raw score < `CONF_SCORE_FLOOR`.

## 6. HTTP API surface (reshaped `/knowledge-base/*`)

Existing route paths are reused so the frontend `api.ts` wrappers and the `anubis-core` docs change minimally. We own the response shapes now, so the old loose field-name normalization is dropped.

- `POST /knowledge-base/search` `{ projectId, query, limit? }` → `{ ok, query, results: [{ source, startLine, endLine, heading, score, excerpt }], lowConfidence }`
- `POST /knowledge-base/ingest` `{ projectId, full? }` → `{ ok, documents, chunks }` (also runs lazily on search when the index is stale/missing)
- `POST /knowledge-base/save` · `/update` · `/delete` `{ projectId, path, content?, force? }` → write markdown under `knowledge/`, re-index
- `GET /knowledge-base/stats?projectId` → `{ ok, documentCount, chunkCount, lastIndexedAt }`
- `GET /knowledge-base/documents?projectId` → `{ ok, items: [{ path, title, chunkCount, updatedAt }] }`

**Removed routes:** `/context-pack`, `/graph`, `/graph/neighborhood`, `/ignore-file`.

## 7. Data model & paths

- **Source of truth:** `<workspace>/knowledge/**/*.md` — the existing standardized tree (`brand/`, `product/`, `audience/`, …) documented in `anubis-core/workspace.md`. v1 indexes a single `knowledge` scope (lessons deferred).
- **Index:** `<dataDir>/knowledge-lite/<projectId>/index.db` — per-project, rebuilt on demand, deletable. Cleanup wired into the existing project-delete path (replacing `deleteKnowledgeBaseForWorkdir`).
- **Freshness:** per-file `content_hash` stored in the `documents` table; on search, a cheap hash + membership compare against `knowledge/` decides whether to rebuild (ports `ensure_fresh_index`). Incremental ingest reuses unchanged files' chunks (content-hash keyed).

## 8. Teardown / migration

- **Remove engine driving:** the `callEngine`/`spawnCliJson` path for the engine; `engineBinaryPath` from the config Zod schema (`packages/backend/src/config.ts`), `app-config.ts`, and the Settings "External binaries" field (`settings.tsx`). **Keep** `extractorBinaryPath` — the extractor stays an external binary.
- **Remove automatic context-pack injection:** `contextPacker` (`services.ts`), the pipeline `contextPack` dependency + steps (`content-pipeline/factory.ts`, `pipeline-service.ts`), the conversation prompt-enrichment that consumed context-pack (`conversation-service.ts`), and `contextPackBudget` plumbing in the frontend (`active-conversation.tsx`). The pipeline prompts' `{{context}}` placeholder is **dropped** — the agent searches the KB itself instead of receiving pre-packed context.
- **Frontend:** repoint `pages/knowledge-base.tsx` + `api.ts` wrappers to the new search response shape; **remove** `pages/knowledge-graph.tsx`, the graph bits of `lib/use-kb-loader.ts`, and the graph sidebar entry (parked until graph lands). **Keep** the KB search page + its sidebar entry.
- **Docs:** rewrite the Knowledge Base section of `packages/ai-agent/skills/auto-inject/anubis-core/workspace.md` to lite semantics; add a short superseding note to ADR 0001/0002.
- **No data migration:** first use ingests fresh from `knowledge/`. Old `<dataDir>/engine` state is left in place (noted for manual cleanup; harmless).

## 9. Error handling

- Engine throws typed errors (`ValidationError`, `IndexStoreError`, `FileSystemError`) mirroring the Python tool; the backend maps them to HTTP 400 (validation) / 500 (store/fs) via the existing `app.ts` normalization.
- **Path safety** on `save`/`update`/`delete`: target paths must stay within `knowledge/` — no absolute paths, drive letters, or `..` segments; `.md` only (ports `validate_target_path` / `reject_bad_document_path`).
- The single-flight `withEngineLock` is retained for sqlite writes.
- Search against an empty/missing index returns empty results (with a lazy ingest first), not an error.

## 10. Testing

- **Unit (vitest, in-package):** port the relevant cases from `test_engine.py` — chunking, `normalizeTerms`, `parseQuery`, BM25 scoring, proximity, phrase matching, path validation.
- **Parity gate:** run the ported benchmark over `examples/knowledge` (copied as a fixture) and assert P@1 / MRR ≥ the Python baseline. This is the primary signal that the TS ranker matches the Python ranker.
- **Backend route tests:** `search` / `ingest` / `save` against a temp workspace + temp `dataDir`.
- Follow the repo's test conventions (rebuild a changed package before testing; vitest resolves `@anubis/*` to `dist`).

## 11. Build order

Insert `@anubis/knowledge-lite` into the load-bearing build order immediately **before** `@anubis/backend`:

```
@anubis/research-crawler → @anubis/ai-agent → @anubis/workflow-runtime →
@anubis/conversation → @anubis/knowledge-lite → @anubis/backend →
@anubis/frontend → root vite build → electron-builder
```

Also add it to the `pretest` build set. `better-sqlite3` is already a root dependency, so there is **no electron-builder packaging trap** introduced by this change.

## 12. Risks & open considerations

- **`{{context}}` removal in the content pipeline** changes pipeline behavior: drafts are generated without pre-packed brand/niche context unless the agent (or pipeline step) explicitly searches first. Confirmed acceptable for v1; revisit if draft quality regresses (a pipeline step could call `/search` and inline results).
- **Markdown in git:** `knowledge/` source docs are now in the workspace and may be committed by users. Intended (source of truth, reviewable), but worth a note in docs.
- **Freshness cost:** hashing every `knowledge/` file on each search is cheap for curated corpora (tens–hundreds of small md files) but is an O(files) check; acceptable at expected scale.

## 13. Future (out of scope here)

- Knowledge graph (nodes/edges + HTML viewer) + the frontend graph page restoration.
- Lessons scope (`learn` / `--lessons`) feeding the self-learning loop.
- Optional pipeline step that auto-searches and inlines context (a measured re-introduction of pre-packing, agent-controlled).
