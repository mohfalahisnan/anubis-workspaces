# Crawler — raw Chrome + Instagram automation

This file documents the **raw crawler endpoints**. They drive a real Chrome instance over CDP to capture Instagram profiles or discover new handles. If the user just wants to capture posts for a competitor that already exists in their workspace, use `competitors.md` → `POST /captures/competitors/:id` — it handles persistence for you. Come here when the user wants raw output, or they don't have a competitor record yet.

## When to use this file

- "Open Chrome so I can log in to Instagram." → `chrome/open` with `profile: 'login'`.
- "Scrape `@nasa` but don't save it — just show me what's there." → `instagram/capture-profile` with no competitor.
- "Discover competitors via the hashtag `spacephotography`." → `instagram/discover`.
- "Discover similar accounts from the explore page." → `instagram/discover` with `source: 'explore'`.
- "Scrape this Instagram URL directly." → `instagram/capture-profile` with `url`.

## Mental model — the three Chrome profiles

The crawler always launches/attaches to a real Chrome over CDP. There are three persistent profiles, each on a fixed port:

| Profile | Port | Mode | What it's for |
| --- | --- | --- | --- |
| `login` | 9222 | headed | Signed-in browsing. The user logs into Instagram **once** here; capture/discover with `profile: 'login'` uses that session. Refuses headless unless you pass `forceHeadless: true`. |
| `public` | 9223 | headless | Anonymous browsing. Best default for public profiles and posts — no login needed, won't burn the user's session. |
| `flow` | 9224 | headed | Google Flow scraping. Don't use it for Instagram. |

**Default selection when `profile` is omitted:**

- `capture-profile` → `public` when `remoteDebuggingPort !== 9222`, else `login`.
- `discover` → `login` unless port is `9223`.

When in doubt, set `profile` explicitly. `public` is the right first choice for Instagram capture; switch to `login` only if `public` fails with auth warnings or the target is gated.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/research-crawler/chrome/open` | Launch/attach to a Chrome instance |
| POST | `/research-crawler/instagram/capture-profile` | Scrape one profile + recent posts |
| POST | `/research-crawler/instagram/discover` | Find new competitor handles via explore / hashtag / keyword |

## POST `/research-crawler/chrome/open`

All fields optional:

```ts
{
  url?: string                                    // navigate to this on launch
  profile?: 'login' | 'public' | 'flow'
  profileDir?: string                             // override user-data-dir
  profileDirectory?: string                       // override profile sub-dir
  remoteDebuggingPort?: number
  chromePath?: string                             // falls back to app config
  headless?: boolean
  forceHeadless?: boolean                         // required to headless 'login'
}
```

```bash
# "Open Chrome and let me log in"
curl -s -X POST "$BASE/research-crawler/chrome/open" \
  -H 'Content-Type: application/json' \
  -d '{"profile":"login","url":"https://instagram.com"}'
```

Response: passthrough of `launchChrome()` → `{ ok, url, port, ... }`.

This is the recovery path when capture fails on `public` with auth warnings:

1. Tell the user "I need you to log in — opening Chrome now."
2. Fire `chrome/open` with `{ profile: 'login', url: 'https://instagram.com' }`.
3. Wait for the user to confirm they've logged in.
4. Retry the original capture with `profile: 'login'`.

## POST `/research-crawler/instagram/capture-profile`

```ts
{
  username?: string                               // pass username OR url (refinement)
  url?: string
  chromeOrigin?: string                           // e.g. http://127.0.0.1:9223
  remoteDebuggingPort?: number
  maxResponses?: number                           // 1..200
  timeoutMs?: number
  includeRaw?: boolean
  openNewTab?: boolean
  scrollIntervalMs?: number                       // 1..10000
  initialDelayMs?: number                         // 0..10000
  profile?: 'login' | 'public' | 'flow'
  profileDir?: string
  profileDirectory?: string
  chromePath?: string
  headless?: boolean
  forceHeadless?: boolean
  keepChromeOpen?: boolean
  keepTabOpen?: boolean
}
```

Refinement: must pass either `username` or `url`. Passing both is fine but `url` wins.

```bash
# Anonymous capture by username
curl -s -X POST "$BASE/research-crawler/instagram/capture-profile" \
  -H 'Content-Type: application/json' \
  -d '{"username":"nasa","maxResponses":30,"profile":"public"}'

# Capture a specific URL (e.g. the user pasted one)
curl -s -X POST "$BASE/research-crawler/instagram/capture-profile" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.instagram.com/nasa/","profile":"public"}'
```

Response: `StandardCrawlerOutput`:

```ts
{
  ok: boolean
  schemaVersion: string
  output: { profiles: ProfileData[], posts: PostData[] }
  meta: {
    warnings: string[]
    avgLikes?: { perProfile: { username, avgLikes }[] }
    ...
  }
  error?: { code, message }
}
```

Notes:

- `meta.avgLikes` is a **dominant-cluster mean**, not a plain average — see `packages/research-crawler/src/core/instagram/avg-likes.ts`. Use this number when the user wants "the typical post performance", not `mean(likes)`.
- `meta.warnings` is where auth and rate-limit hints surface. Always check it.
- `keepChromeOpen` / `keepTabOpen` — set to `true` when the user is about to do multiple captures in a row, to avoid the launch-overhead each time.

## POST `/research-crawler/instagram/discover`

```ts
{
  source?: 'explore' | 'hashtag' | 'keyword'
  hashtag?: string                                // required if source='hashtag'
  keyword?: string                                // required if source='keyword'
  chromeOrigin?: string
  remoteDebuggingPort?: number
  targetCompetitors?: number                      // 1..200
  timeoutMs?: number
  includeRaw?: boolean
  profile?: 'login' | 'public' | 'flow'
  profileDir?: string
  profileDirectory?: string
  chromePath?: string
  headless?: boolean
  forceHeadless?: boolean
  keepChromeOpen?: boolean
}
```

Refinements: passing `source: 'hashtag'` without `hashtag` (or `source: 'keyword'` without `keyword`) → 400.

```bash
# By hashtag
curl -s -X POST "$BASE/research-crawler/instagram/discover" \
  -H 'Content-Type: application/json' \
  -d '{"source":"hashtag","hashtag":"spacephotography","targetCompetitors":25}'

# By keyword
curl -s -X POST "$BASE/research-crawler/instagram/discover" \
  -H 'Content-Type: application/json' \
  -d '{"source":"keyword","keyword":"astrophotography","targetCompetitors":20}'

# Explore feed (defaults to 'login' profile — needs a signed-in session)
curl -s -X POST "$BASE/research-crawler/instagram/discover" \
  -H 'Content-Type: application/json' \
  -d '{"source":"explore","targetCompetitors":10,"profile":"login"}'
```

Response shape mirrors `discoverInstagramCompetitors()` — simplified, **not** the standard envelope. Treat the response as opaque per-discovery shape.

When the user picks handles from a discover response and says "add these", do **not** call discover again — switch to `competitors.md` → `POST /competitors` for each, then optionally chain `/captures/competitors/:id`.

## Errors

- `400` — Zod validation (`error.issues`), including refinement failures (`"Pass username or url."`, `"Pass hashtag when source is hashtag."`).
- `500` — internal capture failure (network, CDP, parse). The message tells you what failed; `warnings` is the user-readable hint.

## Workflows the user actually asks for

### "I need to log in to Instagram"

```bash
curl -s -X POST "$BASE/research-crawler/chrome/open" \
  -H 'Content-Type: application/json' \
  -d '{"profile":"login","url":"https://instagram.com"}'
```

Tell the user the window is open and you'll wait. After they confirm, anything they ask for next can use `profile: 'login'`.

### "Discover competitors via #spacephotography, then add the top 5"

```bash
# 1. Discover
curl -s -X POST "$BASE/research-crawler/instagram/discover" \
  -H 'Content-Type: application/json' \
  -d '{"source":"hashtag","hashtag":"spacephotography","targetCompetitors":25}'

# 2. Show the candidates to the user, let them pick.
# 3. For each chosen handle, switch to competitors.md → POST /competitors,
#    then optionally /captures/competitors/:id to scrape their posts.
```

### "Just scrape this URL — don't save anything"

`instagram/capture-profile` with `url`, then show the user `output.profiles[0]` + a few highlights from `output.posts`. If they decide to keep it, ask: "Want me to add this as a competitor in your <project> project?" Then switch to `competitors.md`.

### "Capture failed — what now?"

Inspect `meta.warnings`:

- Auth-related ("please log in", "session", "private account") → run the login flow above, retry with `profile: 'login'`.
- Rate-limit / `429` / "too many requests" → wait a few minutes, then retry with smaller `maxResponses`. Don't loop.
- Selector / parse warnings → Instagram changed their DOM. Tell the user; this needs a code-side fix, no amount of retrying will help.

## Important: this file vs `competitors.md`

If the user has a competitor record (or wants one), prefer `POST /captures/competitors/:id` from `competitors.md`. That route:

- Persists the captured posts (deduped).
- Updates the competitor's stats (`followers`, `avgLikes`, `postCount`, `displayName`, `bio`).
- Supports a `preview: true` mode for dry-runs.

Come here only when the user genuinely doesn't want persistence, or wants a one-off raw call (e.g. capturing a URL the app doesn't track as a competitor yet, or building a sync that goes through the content-item metric path).
