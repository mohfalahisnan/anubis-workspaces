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

Search corpus backed by `anubis-engine`. Respects `.anubisignore` at the workspace root.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/knowledge-base/index` | Index workspace/files |
| POST | `/knowledge-base/search` | Search indexed documents |
| POST | `/knowledge-base/context-pack` | Assemble context window |
| GET | `/knowledge-base/stats` | Get document/edge stats |
| GET | `/knowledge-base/documents` | List indexed documents |
| GET | `/knowledge-base/graph` | Get global knowledge graph |
| GET | `/knowledge-base/graph/neighborhood` | Get local graph neighborhood |
| GET | `/knowledge-base/ignore-file` | Read `.anubisignore` |

### POST /knowledge-base/index
```ts
{
  projectId: string                    // required
  paths?: string[]                     // optional paths to index (default: entire workdir)
}
```

### POST /knowledge-base/search
```ts
{
  projectId: string                    // required
  query: string                        // required
  limit?: number                       // default 20, max 50
  depth?: number                       // search graph depth
}
```

### POST /knowledge-base/context-pack
```ts
{
  projectId: string                    // required
  query: string                        // required
  budget?: number                      // max token budget, default 10000
  includeGraph?: boolean               // default true
}
```

### GET /knowledge-base/graph
```query
GET /knowledge-base/graph?projectId=default&limit=100
```

### GET /knowledge-base/graph/neighborhood
```query
GET /knowledge-base/graph/neighborhood?projectId=default&chunkId=abc&depth=2&limit=50
```

---

## 4. Examples

```bash
# Index a project's workspace
curl -s -X POST "$BASE/knowledge-base/index" -H 'Content-Type: application/json' \
  -d '{"projectId":"'$PID'"}'

# Search for brand context
curl -s -X POST "$BASE/knowledge-base/search" -H 'Content-Type: application/json' \
  -d '{"projectId":"'$PID'","query":"brand voice guidelines"}'
```
