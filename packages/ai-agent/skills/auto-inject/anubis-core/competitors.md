# Competitors, captures, posts

CRUD for competitor records, on-demand capture, and the captured-post feed.

## Endpoints

| Method | Path | Purpose | Source |
| --- | --- | --- | --- |
| GET | `/competitors` | List all | `competitors.ts:29` |
| GET | `/competitors/:id` | Get one (404 if missing) | `competitors.ts:33` |
| POST | `/competitors` | Create | `competitors.ts:39` |
| PATCH | `/competitors/:id` | Update | `competitors.ts:45` |
| DELETE | `/competitors/:id` | Delete | `competitors.ts:51` |
| POST | `/captures/competitors/:id` | Scrape + persist posts + update competitor stats | `captures.ts:38` |
| GET | `/posts` | List captured posts (joined with competitor) | `captures.ts:137` |
| PATCH | `/posts/:id` | Edit a captured post | `captures.ts:167` |
| DELETE | `/posts/:id` | Delete a captured post (recomputes `postCount`) | `captures.ts:175` |

## POST `/competitors`

```ts
{
  handle: string                  // required, min length 1 — e.g. '@nasa'
  displayName?: string
  niche?: string
  tint?: string                   // /^#[0-9A-Fa-f]{6}$/
  followers?: number              // int, >= 0
  avgLikes?: number               // int, >= 0
  notes?: string
}
```

Example:

```bash
curl -s -X POST "$BASE/competitors" \
  -H 'Content-Type: application/json' \
  -d '{"handle":"@nasa","niche":"space","tint":"#0B3D91"}'
```

Response: `{ ok: true, competitor }` (201).

## PATCH `/competitors/:id`

Same shape as create but `handle` cannot change, and `postCount` is allowed:

```ts
{
  displayName?, niche?, tint?, followers?, avgLikes?, postCount?, notes?
}
```

## POST `/captures/competitors/:id`

Body (all optional, `parse` tolerates an empty body):

```ts
{
  profile?: 'login' | 'public' | 'flow'   // default 'public'
  headless?: boolean
  forceHeadless?: boolean
  maxResponses?: number                   // 1..120, default 30
  timeoutMs?: number                      // 1..180000, default 90000
}
```

What it does (`captures.ts:38-116`):

1. Looks up the competitor; 404 if missing.
2. Calls `captureInstagramData` with `username = handle.replace(/^@/, '')`.
3. Persists every post with a `postUrl` via `capturedPosts.upsertMany`.
4. Updates the competitor with `displayName` (from profile fullName), `followers`, `avgLikes`, `postCount`, and refreshes `refreshedAt`.

Example:

```bash
curl -s -X POST "$BASE/captures/competitors/$ID" \
  -H 'Content-Type: application/json' \
  -d '{"profile":"public","maxResponses":60}'
```

Response on success:

```ts
{ ok: true, competitor, capturedCount: number, warnings: string[] }
```

Errors:

- `500` with `error.code = 'CAPTURE_FAILED'` if the crawler throws or returns `ok: false`. `warnings` is included from `result.meta.warnings` when available.

## GET `/posts`

Query string (Zod `safeParse`, returns 400 on bad input):

```ts
{
  competitorId?: string
  limit?: number                  // int, 1..500, default 60
  orderBy?: 'recent' | 'engagement'   // default 'recent'
}
```

Example:

```bash
curl -s "$BASE/posts?competitorId=$ID&limit=100&orderBy=engagement"
```

Response: `{ ok: true, items }` where each item is a `CapturedPost` enriched with `competitorHandle` and `competitorTint`.

## PATCH `/posts/:id`

```ts
{
  caption?: string
  likes?: number                  // int, >= 0
  comments?: number               // int, >= 0
  postedAt?: string
  mediaKind?: 'image' | 'video' | 'carousel'
  mediaUrl?: string
  carouselCount?: number          // int, >= 0
}
```

404 if id unknown.

## DELETE `/posts/:id`

Removes the post; recomputes and persists `postCount` on the owning competitor. 404 if id unknown.

## Workflow — capture-a-new-competitor

Pipe `jq` (available on all three platforms via package manager; built into many CI images) to thread the id through. If `jq` is not installed, parse the JSON response with your shell of choice.

```bash
# 1. Create the competitor record
ID=$(curl -s -X POST "$BASE/competitors" \
  -H 'Content-Type: application/json' \
  -d '{"handle":"@nasa"}' | jq -r .competitor.id)

# 2. Capture (profile=public is anonymous + headless; use 'login' if private/follower-gated)
curl -s -X POST "$BASE/captures/competitors/$ID" \
  -H 'Content-Type: application/json' \
  -d '{"profile":"public","maxResponses":30}'

# 3. Inspect posts
curl -s "$BASE/posts?competitorId=$ID"
```

PowerShell equivalent of step 1 without `jq`:

```powershell
$resp = curl.exe -s -X POST "$env:BASE/competitors" `
  -H 'Content-Type: application/json' -d '{"handle":"@nasa"}'
$ID = ($resp | ConvertFrom-Json).competitor.id
```

If the capture returns `ok: false` with `code: 'CAPTURE_FAILED'` and the warnings mention auth, retry with `profile: 'login'` after the user has signed in via `crawler.md` → `chrome/open` on `profile=login`.
