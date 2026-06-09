# Competitors, captures, posts

Track IG handles, scrape their posts, browse the feed. For user's own drafts use `content.md`.

## Routes

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/competitors?projectId=` | List |
| GET | `/competitors/:id` | Get |
| POST | `/competitors` | Create |
| PATCH | `/competitors/:id` | Update (handle immutable) |
| DELETE | `/competitors/:id` | Delete |
| POST | `/captures/competitors/:id` | Scrape + persist posts |
| GET | `/posts` | Post feed joined with competitor |
| POST | `/posts/import` | Bulk import |
| PATCH | `/posts/:id` | Edit a post |
| DELETE | `/posts/:id` | Delete a post (recomputes postCount) |

## POST /competitors

```ts
{
  handle: string                       // required, e.g. "@nasa"
  projectId?: string                   // default 'default'
  displayName?: string
  niche?: string
  tint?: string                        // /^#[0-9A-Fa-f]{6}$/
  followers?: number                   // int >= 0
  avgLikes?: number                    // int >= 0
  notes?: string
  bio?: string
  level?: 'black'|'green'|'yellow'|'red'
}
```

## PATCH /competitors/:id

Same as create minus `handle` + `projectId`, plus `postCount`. Pass `level: null` to clear.

## POST /captures/competitors/:id

Body (all optional, empty body OK):

```ts
{
  profile?: 'login'|'public'|'flow'    // default 'public'
  headless?: boolean
  forceHeadless?: boolean
  maxResponses?: number                // 1..120, legacy alias
  targetPosts?: number                 // 1..120, default 30
  preview?: boolean                    // true → return candidates, don't persist
  timeoutMs?: number                   // 1..180000, default 90000
}
```

Persisted response:
```ts
{ ok: true, competitor, capturedCount: number, warnings: string[] }
```

Preview response:
```ts
{ ok: true, competitor, posts: EnrichedPost[], candidateCount: number, warnings: string[] }
```

Fail:
- `500 { error: { code: 'CAPTURE_FAILED', message, warnings? } }` — auth warning → retry with `profile: 'login'` after user logs in via `crawler.md` → `chrome/open` with `profile: 'login'`.

## GET /posts

Query: `competitorId?`, `projectId?`, `limit?` (1..500, default 60), `orderBy?` (`recent`|`engagement`, default `recent`).

Items include `competitorHandle`, `competitorTint`, `competitorFollowers`, `competitorAvgLikes`, `competitorLevel`.

## POST /posts/import

```ts
{
  posts: Array<{                       // max 500
    id?: string
    competitorId: string               // required, must exist
    projectId?: string                 // default: owner's project
    username: string                   // required
    postUrl: string                    // required, deduped
    caption?, likes?, comments?, postedAt?
    mediaKind?: 'image'|'video'|'carousel'
    mediaUrl?, carouselCount?, capturedAt?
    raw?: object
  }>
}
```

Unknown `competitorId` → 500 aborts the whole batch.

## PATCH /posts/:id

```ts
{ caption?, likes?, comments?, postedAt?, mediaKind?, mediaUrl?, carouselCount? }
```

## Example

```bash
ID=$(curl -s -X POST "$BASE/competitors" -H 'Content-Type: application/json' \
  -d '{"handle":"@nasa","projectId":"'$PID'"}' | jq -r .competitor.id)
curl -s -X POST "$BASE/captures/competitors/$ID" -H 'Content-Type: application/json' \
  -d '{"profile":"public","targetPosts":30}'
curl -s "$BASE/posts?competitorId=$ID&orderBy=engagement&limit=10"
```

PowerShell without jq: `$ID = (curl.exe -s ... | ConvertFrom-Json).competitor.id`.

`avgLikes` is dominant-cluster mean, not arithmetic.
