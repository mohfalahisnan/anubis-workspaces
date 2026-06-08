# Competitors, captures, posts

This file covers **the research half of the app**: who the user tracks on Instagram, the posts you scrape for them, and the feed the user browses. If the user is producing their *own* content drafts from these posts, switch to `content.md`.

## When to use this file

The user typically asks for things like:

- "Add `@nasa` as a competitor in the *Space* project."
- "List my competitors" / "Show me the black-level competitors."
- "Capture latest posts for `@nasa`" / "Re-scrape, I added more posts."
- "Preview a capture without saving it" — the dry-run case.
- "Show me my recent posts, ordered by engagement."
- "Fix the like count on this post" / "Delete this post, it's not relevant."
- "I exported posts from elsewhere, import these into Anubis."

## Mental model

A **competitor** belongs to a project (defaults to `default`). It has:

- `handle` — required, immutable after create (e.g. `@nasa`). The crawler strips the leading `@`.
- `displayName`, `bio` — derived from the captured profile if not set.
- `followers`, `avgLikes`, `postCount` — updated by capture.
- `tint` — a `#RRGGBB` colour the user picks for visual grouping.
- `level` — `black | green | yellow | red`, the user's own grading. Treat `black` as top-tier.
- `notes` — free text the user owns.
- `niche` — free text classifier.

A **captured post** is keyed on `(competitorId, normalised postUrl)`. The store deduplicates and recomputes the competitor's `avgLikes` (dominant-cluster mean, not arithmetic — see `core/instagram/avg-likes.ts`) and `postCount` after each capture.

The **`/posts` feed** joins each post to its competitor, so list responses include `competitorHandle`, `competitorTint`, `competitorFollowers`, `competitorAvgLikes`, `competitorLevel`.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/competitors?projectId=` | List (project-scoped if provided) |
| GET | `/competitors/:id` | Get one (404 if missing) |
| POST | `/competitors` | Create |
| PATCH | `/competitors/:id` | Update — `handle` cannot change |
| DELETE | `/competitors/:id` | Delete |
| POST | `/captures/competitors/:id` | Scrape + persist posts + update competitor stats |
| GET | `/posts` | Flat post feed joined with competitor |
| POST | `/posts/import` | Bulk-import posts from outside the crawler |
| PATCH | `/posts/:id` | Edit a captured post |
| DELETE | `/posts/:id` | Delete a captured post (recomputes `postCount`) |

All bodies are `.strict()` Zod — unknown keys → 400.

## POST `/competitors`

```ts
{
  handle: string                  // required, min length 1
  projectId?: string              // omitted → 'default'
  displayName?: string
  niche?: string
  tint?: string                   // /^#[0-9A-Fa-f]{6}$/
  followers?: number              // int, >= 0
  avgLikes?: number               // int, >= 0
  notes?: string
  bio?: string
  level?: 'black' | 'green' | 'yellow' | 'red'
}
```

```bash
curl -s -X POST "$BASE/competitors" \
  -H 'Content-Type: application/json' \
  -d '{"handle":"@nasa","projectId":"'$PID'","niche":"space","tint":"#0B3D91","level":"green"}'
```

Response: `{ ok: true, competitor }` (201). Tell the user the id and the handle.

## PATCH `/competitors/:id`

Same shape, minus `handle` and `projectId`, plus `postCount`. To clear `level`, pass `null`:

```ts
{
  displayName?, niche?, tint?, followers?, avgLikes?, postCount?, notes?, bio?,
  level?: 'black' | 'green' | 'yellow' | 'red' | null
}
```

## POST `/captures/competitors/:id`

Body (all optional — empty body is fine):

```ts
{
  profile?: 'login' | 'public' | 'flow'   // default 'public'
  headless?: boolean
  forceHeadless?: boolean
  maxResponses?: number                   // 1..120, legacy alias for targetPosts
  targetPosts?: number                    // 1..120, default 30 — preferred name
  preview?: boolean                       // true → don't persist, return candidates
  timeoutMs?: number                      // 1..180000, default 90000
}
```

What it does (`captures.ts`):

1. Looks up the competitor; 404 if missing.
2. Calls `captureInstagramData` with `username = handle.replace(/^@/, '')`.
3. If `preview: true` — returns the candidate posts + the competitor unchanged. Use this when the user wants to *see what would be saved* before committing.
4. Otherwise persists posts via `capturedPosts.upsertMany` (dedup on normalised `postUrl`), then refreshes the competitor's `displayName`, `bio`, `followers`, `avgLikes`, `postCount`, and `refreshedAt`.

```bash
# Real capture
curl -s -X POST "$BASE/captures/competitors/$ID" \
  -H 'Content-Type: application/json' \
  -d '{"profile":"public","targetPosts":60}'

# Dry-run preview
curl -s -X POST "$BASE/captures/competitors/$ID" \
  -H 'Content-Type: application/json' \
  -d '{"profile":"public","targetPosts":30,"preview":true}'
```

Persisted response:

```ts
{ ok: true, competitor, capturedCount: number, warnings: string[] }
```

Preview response:

```ts
{ ok: true, competitor, posts: EnrichedPost[], candidateCount: number, warnings: string[] }
```

Capture errors return `500` with one of:

- `error.code = 'CAPTURE_FAILED'` — the crawler threw or returned `ok:false`. Check `error.message` and `error.warnings` (when surfaced). Auth warnings = user needs to log in via `crawler.md` → open Chrome on `profile: 'login'`, then retry with `profile: 'login'`.

## GET `/posts`

Query string:

```ts
{
  competitorId?: string
  projectId?: string
  limit?: number                          // int, 1..500, default 60
  orderBy?: 'recent' | 'engagement'       // default 'recent'
}
```

```bash
curl -s "$BASE/posts?competitorId=$ID&limit=100&orderBy=engagement"
curl -s "$BASE/posts?projectId=$PID&orderBy=engagement&limit=50"
```

Response: `{ ok: true, items }` — each item is the raw `CapturedPost` plus `competitorHandle`, `competitorTint`, `competitorFollowers`, `competitorAvgLikes`, `competitorLevel`.

## POST `/posts/import`

Bulk import up to 500 posts from outside the crawler (e.g. user pasted a CSV, exported from another tool):

```ts
{
  posts: Array<{
    id?: string
    competitorId: string                  // required — must already exist
    projectId?: string                    // omitted → owner competitor's project
    username: string                      // required
    postUrl: string                       // required, deduped via normalisation
    caption?: string
    likes?: number                        // int >= 0
    comments?: number                     // int >= 0
    postedAt?: string                     // ISO string
    mediaKind?: 'image' | 'video' | 'carousel'
    mediaUrl?: string
    carouselCount?: number                // int >= 0
    capturedAt?: number                   // int >= 1 (epoch ms)
    raw?: Record<string, unknown>
  }>                                      // max 500
}
```

Response: `{ ok: true, importedCount }`. Behind the scenes the route refreshes `postCount` and `avgLikes` for each touched competitor. Any unknown `competitorId` aborts the whole batch with 500.

## PATCH `/posts/:id`

```ts
{
  caption?: string
  likes?: number                          // int >= 0
  comments?: number                       // int >= 0
  postedAt?: string
  mediaKind?: 'image' | 'video' | 'carousel'
  mediaUrl?: string
  carouselCount?: number                  // int >= 0
}
```

404 if id unknown. Response: `{ ok: true, post }` — `post` is the enriched (competitor-joined) shape.

## DELETE `/posts/:id`

Removes the post; recomputes and persists `postCount` on the owning competitor.

## Workflows the user actually asks for

### Add a competitor and pull their first capture

```bash
# 1. Create
ID=$(curl -s -X POST "$BASE/competitors" \
  -H 'Content-Type: application/json' \
  -d '{"handle":"@nasa","projectId":"'$PID'"}' | jq -r .competitor.id)

# 2. Capture (public/anonymous is enough for public profiles)
curl -s -X POST "$BASE/captures/competitors/$ID" \
  -H 'Content-Type: application/json' \
  -d '{"profile":"public","targetPosts":30}'

# 3. Show the user what landed
curl -s "$BASE/posts?competitorId=$ID&orderBy=engagement&limit=10"
```

PowerShell without `jq`:

```powershell
$resp = curl.exe -s -X POST "$env:BASE/competitors" `
  -H 'Content-Type: application/json' -d '{"handle":"@nasa"}'
$ID = ($resp | ConvertFrom-Json).competitor.id
```

### Capture failed with auth warnings

If `code = 'CAPTURE_FAILED'` and `warnings` mention login/auth:

1. `crawler.md` → `POST /research-crawler/chrome/open` with `{ "profile":"login", "url":"https://instagram.com" }`. Tell the user "I opened Chrome — please log in and let me know when you're done."
2. After they confirm, retry the capture with `{ "profile":"login" }`.

### "Show me the top-engagement posts in this project"

```bash
curl -s "$BASE/posts?projectId=$PID&orderBy=engagement&limit=30"
```

Then if the user wants to turn one of these into a draft of their own, switch to `content.md` → `POST /content-items` with `referencePostId`.
