# Import / Export — Project Snapshot (Competitors + Captured Posts)

**Date:** 2026-06-11
**Status:** Approved design, pending implementation plan
**Scope:** Round-trip JSON import/export of a project's competitors and their captured Instagram posts ("konten"), for moving data between installs/machines.

## Problem & goal

There is currently no way to get competitors and their captured posts out of one Anubis
install and into another. Competitors are created one-at-a-time (`POST /competitors`) and
posts arrive only through capture/`POST /posts/import`. We want a single, self-consistent
file a user can export from one machine and import on another.

**Use case:** move data between installs/machines (full backup/restore), not spreadsheet
editing and not cross-project seeding (those are explicit non-goals for v1).

## Decisions (locked)

- **Entities:** competitors + captured posts (`captured_posts`, the competitor IG posts).
  Content items (`content_items`, editorial pipeline) are **out of scope**.
- **Format:** a single JSON file. No CSV.
- **Trigger:** UI buttons on the **Competitors page** (export + import), plus the backend
  endpoints that power them.
- **Shape:** one combined **project snapshot** (Approach A). Posts ride along with their
  competitors so relationships are always intact; there is no posts-only file in v1.

## Key constraint discovered during design

Competitor handles are **globally unique**, not per-project:

```sql
-- 002_competitors.sql
CREATE UNIQUE INDEX uq_competitors_handle_active
  ON competitors(handle) WHERE deleted_at IS NULL;
```

`findByHandle(handle)` does not filter by project. Migration 008 added `project_id` but did
**not** rebuild this index to `(project_id, handle)`. Therefore import must match competitors
by handle **globally** and cannot create a second row for an existing handle. See import rules.

## File format — `anubis-project-snapshot` v1

```jsonc
{
  "kind": "anubis-project-snapshot",
  "schemaVersion": 1,
  "exportedAt": 1733900000000,            // epoch ms
  "app": { "name": "anubis", "version": "2.8.0" },  // root package.json version, informational
  "project": {                            // informational only — import targets the active project
    "id": "default",
    "name": "Default Project",
    "emoji": "📁",
    "color": null,
    "description": null
  },
  "competitors": [
    {
      "handle": "@ali.abdaal",            // link key; required
      "displayName": "Ali Abdaal",
      "niche": "productivity",
      "tint": "#7c3aed",
      "followers": 1200000,
      "avgLikes": 35000,
      "postCount": 42,
      "lastRefreshedAt": 1733000000000,
      "notes": "…",
      "bio": "…",
      "level": "green",                   // 'black'|'green'|'yellow'|'red' | null
      "addedAt": 1700000000000,
      "updatedAt": 1733000000000
    }
  ],
  "capturedPosts": [
    {
      "competitorHandle": "@ali.abdaal",  // link key into competitors[]; required
      "username": "ali.abdaal",
      "postUrl": "https://www.instagram.com/p/ABC123/",
      "caption": "…",
      "likes": 40000,
      "comments": 800,
      "postedAt": "2025-11-01T12:00:00.000Z",  // verbatim IG ISO string
      "mediaKind": "carousel",            // 'image'|'video'|'carousel' | null
      "mediaUrl": "https://…",
      "carouselCount": 7,
      "capturedAt": 1733000000000,
      "raw": { /* full PostData JSON, optional */ }
    }
  ]
}
```

**Omitted on purpose** (re-derived on import): competitor `id`, `projectId`, `deletedAt`;
post `id`, `competitorId`. Only active (non-deleted) rows are exported.

## Backend

New isolated module `packages/backend/src/snapshot.ts`, mounted in `app.ts`. Depends only on
`competitorsRepo` and `capturedPostsRepo`. Errors flow through the existing normalizer
(`ZodError → 400 with issues`, else 500).

### `GET /snapshot/export?projectId=<id>`

- `projectId` optional; defaults to `'default'`. 404 if the project does not exist.
- Builds the snapshot for that project:
  - `competitors` = `competitorsRepo.list(projectId)` mapped to the export shape.
  - `capturedPosts` = posts for those competitors, each tagged with its competitor's
    `handle` as `competitorHandle`. (List per competitor via the posts repo; no project posts
    are included whose competitor isn't in the export.)
- Returns the snapshot object as JSON (the frontend turns it into a downloaded file).

### `POST /snapshot/import`

- Body: `{ projectId?: string, snapshot: ProjectSnapshot }`.
- `projectId` (target) optional; defaults to `'default'`. 404 if the project does not exist.
- **Zod-validates** the snapshot: `kind === 'anubis-project-snapshot'`, `schemaVersion === 1`,
  arrays well-formed. Unsupported `kind`/`schemaVersion` → **400** with a clear message.
- Runs the whole import inside a **single `better-sqlite3` transaction** (atomic — any thrown
  error rolls back). Returns:

```jsonc
{
  "ok": true,
  "competitors": { "created": 3, "matched": 1 },
  "posts": { "imported": 120, "skipped": 8 },
  "warnings": ["post for unknown competitor @ghost skipped (3 posts)"]
}
```

### Import rules (dedup / conflicts)

1. **Competitors — matched by handle, globally.**
   - `findByHandle(handle)`: if found *anywhere*, reuse that competitor row as-is (no field
     overwrite) → counts as `matched`. Its posts attach to it.
   - If not found, insert a fresh competitor (new UUIDv7) scoped to the target `projectId` →
     counts as `created`.
   - *Documented behavior:* because handles are global, if a handle already exists in a
     **different** project, the import reuses it and its imported posts land in that
     competitor's project, not necessarily the target project. For the primary "fresh install"
     case the DB is empty, so everything inserts cleanly into the target project.
2. **Posts — upserted by `(competitorId, normalized postUrl)`** via the existing
   `capturedPostsRepo.upsertMany` dedup. Re-importing the same file is idempotent; already
   present posts count as `skipped`.
3. **Orphan posts:** a post whose `competitorHandle` is neither in `snapshot.competitors` nor
   resolvable in the DB → skipped, aggregated into a non-fatal `warning`.
4. **IDs from the file are never trusted** as primary keys.
5. After import, refresh `post_count` for each affected competitor (same path the existing
   `/posts/import` uses).

## Frontend

Buttons on the **Competitors page** (`packages/frontend/src/pages/competitors.tsx`),
in the existing header/toolbar area.

- **Export:** calls `exportProjectSnapshot(projectId)`, serializes the result, and triggers a
  browser download named `anubis-<projectSlug>-<YYYYMMDD>.json` (Blob + object URL + anchor
  click — works in the Electron renderer / Chromium).
- **Import:** a hidden `<input type="file" accept="application/json,.json">`. On select: read
  the file text, `JSON.parse`, lightly sanity-check `kind`, then `POST /snapshot/import` for
  the active project. Show the result summary (created / matched / imported / skipped +
  warnings) in a toast or small dialog, then refresh the competitors list (and counts).
- Disable the buttons while a request is in flight; surface parse/HTTP errors inline.

New `packages/frontend/src/api.ts` helpers: `exportProjectSnapshot(projectId)`,
`importProjectSnapshot(projectId, snapshot)`.

## Shared types (`packages/shared/src/index.ts`)

- `ProjectSnapshot`, `SnapshotCompetitor`, `SnapshotCapturedPost` — the file shape.
- `ImportSnapshotResult` — the import response shape.

These are pure data types (no Node/React), consistent with the rest of `@anubis/shared`.
Rebuild `@anubis/shared` so the frontend/backend pick up the new types.

## Error handling summary

| Situation | Behavior |
|---|---|
| Export, unknown projectId | 404 |
| Import, unknown target projectId | 404 |
| Import, wrong `kind` / unsupported `schemaVersion` | 400 with message |
| Import, malformed body (Zod) | 400 with issues |
| Import, orphan post (unknown competitor) | skipped, non-fatal `warning` |
| Import, mid-transaction failure | full rollback, 500 |
| Frontend, non-JSON / wrong-kind file | inline error, nothing sent |

## Testing

Backend tests (`packages/backend/tests/`, vitest):

- **Export shape:** seeded project with competitors + posts → snapshot includes posts tagged
  with `competitorHandle`, excludes other projects' data and soft-deleted rows.
- **Round-trip:** export project A → import into a fresh/empty project → competitor + post
  counts match; posts correctly re-linked by handle.
- **Idempotent re-import:** importing the same file twice → second run reports
  `competitors.created = 0`, all posts `skipped`.
- **Handle conflict:** importing a competitor whose handle already exists → `matched` (no
  duplicate row), its posts attach.
- **Orphan post:** post with a `competitorHandle` absent from competitors and DB → skipped +
  warning.
- **Invalid schema:** wrong `kind` / `schemaVersion` → 400.

Shared test (`packages/shared/tests/`): snapshot schema validation accepts a valid sample and
rejects malformed ones.

## Out of scope (v1)

- Content items (`content_items`) import/export.
- CSV.
- Posts-only export (future small extension: Content-page button emitting the same schema with
  `competitors: []`; the import already tolerates that).
- Cross-project re-scoping / seeding semantics beyond the global-handle behavior noted above.
- Media file/binary export — only URLs and metadata are carried.
