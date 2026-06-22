# Workspace & Knowledge Base

Workspace directory structures and searchable knowledge base.

## 1. Standardized Folder Structure

Every Anubis workspace (under a conversation or project `workdir`) is standardized with the following directory and metadata file structure. Do not place files ad-hoc; organize them according to this structure:

```
workspace-root/
  .agents/              # Auto-inject/active skill files
  .codex/               # Codex configurations
  .claude/              # Claude Code configurations
  CLAUDE.md             # Workspace system prompt & rules
  AGENTS.md             # Agent entry pointer
  .anubisignore         # Search engine ignore patterns

  _workspace.md         # Workspace metadata & notes

  knowledge/            # Knowledge base source documents
    brand/              # Brand guidelines and details
    product/            # Product sheets and specifications
    audience/           # Target persona and demographics
    competitors/        # Competitor analyses
    campaigns/          # Campaign plans
    content-history/    # Past posts and performances
    workflows/          # Workflow details
    decisions/          # ADRs and decision logs
    references/         # General documents and articles

  inbox/                # Inbound raw and pending files
    raw/                # Unprocessed/incoming files
    pending/            # Selected/queued for processing
    processed/          # Completed ingestion

  outputs/              # Generated draft assets
    drafts/             # Content item copy drafts
    reports/            # Generated analytical reports
    exports/            # Data backups and exports
    generated-assets/   # Images, videos, generated media
    reviews/            # Stakeholder review feedback

  runtime/              # Runtime caches and logs
    temp/               # Temporary scratch directories
    cache/              # Build and crawler caches
    logs/               # System and crawler logs
    indexes/            # Locally-compiled index caches

  datasets/             # Ingested datasets
    imports/            # Imported metrics and CSVs
    exports/            # Cleaned data exports
    snapshots/          # DB or workspace state snapshots
```

## 2. Routes — Workspaces

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/workspaces` | List remembered workdirs |
| DELETE | `/workspaces` | Forget (path in body) |

### DELETE /workspaces
```ts
{ path: string }                       // body, not URL
```
Removes from picker history. Does not touch filesystem.

---

## 3. Routes — Knowledge Base

Local markdown knowledge base for the active project. Source of truth is the
project's `knowledge/` folder; the index is rebuilt automatically when files change.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/knowledge-base/search` | Search the knowledge base (cited excerpts) |
| POST | `/knowledge-base/ingest` | Rebuild the index from `knowledge/` |
| POST | `/knowledge-base/save` | Add a markdown doc under `knowledge/` |
| POST | `/knowledge-base/update` | Replace an existing markdown doc |
| POST | `/knowledge-base/delete` | Delete a markdown doc |
| GET | `/knowledge-base/stats` | Document/chunk counts |
| GET | `/knowledge-base/documents` | List indexed documents |

### Workflow — recall before answering

Before answering from project knowledge, search and cite the source path + line range:

```bash
curl -s -X POST "$BASE/knowledge-base/search" -H 'Content-Type: application/json' \
  -d '{"projectId":"'$PID'","query":"brand voice guidelines"}'
```

Each result has `source`, `excerptStartLine`-`excerptEndLine`, `score`, and `excerpt`.
Cite `source:excerptStartLine`. If the response has `lowConfidence: true`, the answer
may not be in the knowledge base — do not invent it. Use a double-quoted span inside
the query for an exact phrase, e.g. `"price objection"`. To capture new knowledge,
POST `/knowledge-base/save` with a `path` under `knowledge/` and markdown `content`.
