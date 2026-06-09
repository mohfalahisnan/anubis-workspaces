# Raw crawler

Drive Chrome over CDP. Scrape IG profiles. Discover handles. For tracked competitors prefer `competitors.md` → `POST /captures/competitors/:id` (it persists + updates stats).

## Chrome profiles

| Profile | Port | Mode | Use |
| --- | --- | --- | --- |
| `login` | 9222 | headed | Signed-in IG browsing. User logs in once here. |
| `public` | 9223 | headless | Anonymous IG capture. Default. |
| `flow` | 9224 | headed | Google Flow. Not for IG. |

Default profile (when omitted):
- `capture-profile` → `public` unless port = 9222.
- `discover` → `login` unless port = 9223.

`login` refuses headless without `forceHeadless: true`.

## Routes

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/research-crawler/chrome/open` | Launch/attach Chrome |
| POST | `/research-crawler/instagram/capture-profile` | Scrape one profile + posts |
| POST | `/research-crawler/instagram/discover` | Find new handles |

## POST /research-crawler/chrome/open

All optional:
```ts
{
  url?, profile?: 'login'|'public'|'flow'
  profileDir?, profileDirectory?, remoteDebuggingPort?
  chromePath?, headless?, forceHeadless?
}
```

Response: `launchChrome()` passthrough → `{ ok, url, port, ... }`.

Login flow: `{ "profile":"login", "url":"https://instagram.com" }`. Tell user to log in, wait, then retry their original capture with `profile: 'login'`.

## POST /research-crawler/instagram/capture-profile

```ts
{
  username?: string                    // pass username OR url
  url?: string
  chromeOrigin?, remoteDebuggingPort?
  maxResponses?: number                // 1..200
  timeoutMs?, includeRaw?, openNewTab?
  scrollIntervalMs?: number            // 1..10000
  initialDelayMs?: number              // 0..10000
  profile?, profileDir?, profileDirectory?
  chromePath?, headless?, forceHeadless?
  keepChromeOpen?, keepTabOpen?
}
```

Must pass `username` OR `url`.

Response: `StandardCrawlerOutput`:
```ts
{
  ok: boolean
  schemaVersion: string
  output: { profiles: ProfileData[], posts: PostData[] }
  meta: {
    warnings: string[]
    avgLikes?: { perProfile: { username, avgLikes }[] }
  }
  error?: { code, message }
}
```

`avgLikes` is dominant-cluster mean. Surface `warnings[]`.

## POST /research-crawler/instagram/discover

```ts
{
  source?: 'explore'|'hashtag'|'keyword'
  hashtag?: string                     // required if source='hashtag'
  keyword?: string                     // required if source='keyword'
  chromeOrigin?, remoteDebuggingPort?
  targetCompetitors?: number           // 1..200
  timeoutMs?, includeRaw?
  profile?, profileDir?, profileDirectory?
  chromePath?, headless?, forceHeadless?, keepChromeOpen?
}
```

Bad refinement (missing `hashtag` / `keyword`) → 400. Response is NOT the standard envelope — opaque shape from `discoverInstagramCompetitors()`.

`explore` source needs a signed-in session. Use `profile: 'login'`.

## Errors

- `400` — Zod validation, refinement failures.
- `500` — internal capture failure. Check `error.message` + `meta.warnings`.

Common warning → fix:
- "log in" / "session" / "private" → run login flow above, retry with `profile: 'login'`.
- 429 / rate-limit → wait, retry with smaller `maxResponses`. No loop.
- selector / parse → IG changed DOM. Tell user; needs code fix.

## Examples

```bash
# Login
curl -s -X POST "$BASE/research-crawler/chrome/open" -H 'Content-Type: application/json' \
  -d '{"profile":"login","url":"https://instagram.com"}'

# Capture
curl -s -X POST "$BASE/research-crawler/instagram/capture-profile" -H 'Content-Type: application/json' \
  -d '{"username":"nasa","maxResponses":30,"profile":"public"}'

# Discover
curl -s -X POST "$BASE/research-crawler/instagram/discover" -H 'Content-Type: application/json' \
  -d '{"source":"hashtag","hashtag":"spacephotography","targetCompetitors":25}'
```
