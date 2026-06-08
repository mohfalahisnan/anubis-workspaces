# Projects + content items

This file is the **production half** of the app: the user's own content drafts, organised into projects. If you're scraping competitors, you're in `competitors.md`. If you're managing to-dos, you're in `tasks.md`. This file is for things the user is *making*.

## When to use this file

Typical asks:

- "Make a new project called *Lunar Marketing*."
- "List my projects."
- "Create a draft from this competitor post."
- "Create a draft from this URL I'm researching."
- "Move this draft to review / scheduled / published."
- "Mark this draft as rejected — note: too off-brand."
- "I just published this — here's the URL. Sync the metrics."
- "Show me everything in `review` status for this project."

## Mental model

A **project** is a container for competitors, captured posts, content items, tasks, and workflows. Every project has an `id`; the special `default` project always exists and cannot be deleted.

A **content item** is one draft the user is producing. It always references a source — either a captured post (`referencePostId`) or an external URL (`referenceUrl`) — **exactly one**, never both. It moves through this status lifecycle:

```
idea → brief → draft → review → scheduled → published → rejected
```

Each transition is just a `PATCH`. The lifecycle isn't enforced — you can jump statuses — but use it as a sane default ordering when the user is vague.

When a content item reaches `published` and the user provides `publishedUrl`, you can call `POST /content-items/:id/sync-metrics` to scrape the live post and pull `likes`/`comments` into `analytics`. This requires the public profile path on the live URL — it uses the `public` Chrome profile internally.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/projects` | List all projects |
| GET | `/projects/:id` | Get one (404 if missing) |
| POST | `/projects` | Create |
| PATCH | `/projects/:id` | Update |
| DELETE | `/projects/:id` | Soft-delete (403 if `id === 'default'`) |
| GET | `/content-items?projectId&status&limit` | List, scoped |
| GET | `/content-items/:id` | Get one (404 if missing) |
| POST | `/content-items` | Create — needs exactly one of `referencePostId` / `referenceUrl` |
| PATCH | `/content-items/:id` | Update (status, drafts, analytics, etc.) |
| DELETE | `/content-items/:id` | Soft-delete |
| POST | `/content-items/:id/sync-metrics` | Re-scrape `publishedUrl` and overwrite analytics |

## Projects

### POST `/projects`

```ts
{
  name: string                   // required
  emoji?: string                 // single emoji recommended
  color?: string                 // any CSS colour the UI can render
  description?: string
  workdir?: string               // optional default cwd for conversations in this project
}
```

```bash
curl -s -X POST "$BASE/projects" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Lunar Marketing","emoji":"🌙","color":"#0B3D91"}'
```

Response: `{ ok: true, project }` (201).

### PATCH `/projects/:id`

```ts
{ name?, emoji?, color?, description?, workdir? }
```

Returns `{ ok: true, project }` or 404.

### DELETE `/projects/:id`

Soft-delete. Returns `403 { error: 'Cannot delete default project' }` for `id === 'default'`. Listing/get hides soft-deleted projects but child rows still reference the id — warn the user before deleting a project with active content.

## Content items

### POST `/content-items`

```ts
{
  projectId?: string                                  // omitted → 'default' (or reference's project)
  referencePostId?: string                            // exactly one of these two
  referenceUrl?: string                               // URL
  title: string                                       // required, trimmed
  status?: 'idea' | 'brief' | 'draft' | 'review' | 'scheduled' | 'published' | 'rejected'
  rawBrief?: string
  improvedDraft?: string
  sourceWorkflowRunId?: string                        // if produced by a workflow
  sourceConversationId?: string                       // if produced by a chat
}
```

**Refinement** — exactly one of `referencePostId` or `referenceUrl`. Passing both, or neither, → 400 with `path: ['referencePostId']`.

**Project alignment** — if `referencePostId` is set and the post's `projectId` differs from the body's `projectId`, the route returns `400 { error: 'reference_project_mismatch' }`. Either omit `projectId` (it'll inherit from the post) or use the post's project.

```bash
# From a captured post the user already saw
curl -s -X POST "$BASE/content-items" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Riff on NASA reel","referencePostId":"'$POST_ID'","status":"idea"}'

# From an external URL
curl -s -X POST "$BASE/content-items" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Article hook","referenceUrl":"https://example.com/post","projectId":"'$PID'"}'
```

404 responses:

- `{ error: 'reference_not_found' }` — `referencePostId` doesn't exist.

### GET `/content-items`

```ts
?projectId=<id>&status=<status>&limit=<int 1..500, default 200>
```

Each item is returned in the `ContentItemSummary` shape — flat fields plus an `analytics` object and a `referencePost` summary when the reference resolves.

### PATCH `/content-items/:id`

```ts
{
  title?: string
  status?: 'idea' | 'brief' | 'draft' | 'review' | 'scheduled' | 'published' | 'rejected'
  rawBrief?: string
  improvedDraft?: string
  rejectionReason?: string | null
  publishedUrl?: string | null
  publishedAt?: string | null
  analytics?: {
    likes?: number | null         // int >= 0
    comments?: number | null      // int >= 0
    saves?: number | null         // int >= 0
  }
  sourceWorkflowRunId?: string | null
  sourceConversationId?: string | null
}
```

`null` clears a previously-set value. The body is `.strict()` — unknown keys → 400.

```bash
# Move to review
curl -s -X PATCH "$BASE/content-items/$CID" \
  -H 'Content-Type: application/json' \
  -d '{"status":"review"}'

# Reject with a reason
curl -s -X PATCH "$BASE/content-items/$CID" \
  -H 'Content-Type: application/json' \
  -d '{"status":"rejected","rejectionReason":"Tone too aggressive for this niche"}'

# Mark published
curl -s -X PATCH "$BASE/content-items/$CID" \
  -H 'Content-Type: application/json' \
  -d '{"status":"published","publishedUrl":"https://instagram.com/p/abcd","publishedAt":"2026-06-08T12:00:00Z"}'
```

### POST `/content-items/:id/sync-metrics`

No body. Pre-requisites:

- The item must exist (404 otherwise).
- The item must have `publishedUrl` set (400 `missing_published_url` otherwise).

What it does: calls `captureInstagramData` for the published URL on the `public` Chrome profile (anonymous, headless), pulls the first post returned, and writes `likes`, `comments`, and `metricsSyncedAt` back to the item.

```bash
curl -s -X POST "$BASE/content-items/$CID/sync-metrics"
```

Error responses:

- `400 missing_published_url` — set `publishedUrl` via PATCH first.
- `404 no_post_metrics_found` — the URL didn't resolve to a post (e.g. taken down).
- `500 { code: 'SYNC_FAILED', message }` — crawler threw or returned `ok:false`. The message tells you why; auth failures mean the post is private/gated and `public` can't see it.

## Workflows the user actually asks for

### "Turn this post into a draft"

```bash
# User pointed at a captured post (you already know POST_ID from /posts)
curl -s -X POST "$BASE/content-items" \
  -H 'Content-Type: application/json' \
  -d '{"title":"<their title or a generated one>","referencePostId":"'$POST_ID'","status":"idea"}'
```

Don't invent a `projectId` — let the backend inherit it from the referenced post. The list response includes the reference post's caption, media, and competitor info, so once it exists you can pull it back via `GET /content-items/:id` and use it as the briefing material for further writing.

### "Show me my pipeline for *Space* this week"

```bash
curl -s "$BASE/content-items?projectId=$PID&status=draft"
curl -s "$BASE/content-items?projectId=$PID&status=review"
curl -s "$BASE/content-items?projectId=$PID&status=scheduled"
```

Summarise counts per status, then list a few titles per bucket.

### "I published it — track how it does"

1. PATCH the item: `status=published`, `publishedUrl`, `publishedAt` (ISO).
2. Immediately POST `/content-items/:id/sync-metrics` to seed `analytics`.
3. Tell the user to re-run sync periodically (or wire it into a workflow / cron).
