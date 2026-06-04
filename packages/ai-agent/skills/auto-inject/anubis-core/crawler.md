# Crawler — `/research-crawler/*`

CDP-driven Instagram + Google Flow automation. Backend wraps `@anubis/research-crawler`.

## Endpoints

| Method | Path | Purpose | Source |
| --- | --- | --- | --- |
| POST | `/research-crawler/chrome/open` | Launch/attach to a Chrome instance for a given profile | `research-crawler.ts:81` |
| POST | `/research-crawler/instagram/capture-profile` | Scrape one Instagram profile + recent posts | `research-crawler.ts:90` |
| POST | `/research-crawler/instagram/discover` | Discover competitor handles via explore / hashtag / keyword | `research-crawler.ts:103` |

## Profile semantics

Three side-by-side Chrome profiles (`packages/research-crawler/src/core/chrome/profile-resolver.ts`):

| Profile | Port | Mode | Use for |
| --- | --- | --- | --- |
| `login` | 9222 | headed | Log in to Instagram once. Refuses headless without `forceHeadless: true`. |
| `public` | 9223 | headless | Post capture, anonymous. |
| `flow` | 9224 | headed | Google Flow scraping. |

If `profile` is omitted, capture defaults to `public` when `remoteDebuggingPort !== 9222`, otherwise `login`. Discover defaults to `login` unless port is 9223.

## POST `/research-crawler/chrome/open`

Body (all optional):

```ts
{
  url?: string                        // initial URL
  profile?: 'login' | 'public' | 'flow'
  profileDir?: string                 // override user-data-dir
  profileDirectory?: string           // override profile sub-dir
  remoteDebuggingPort?: number
  chromePath?: string                 // falls back to app config
  headless?: boolean
  forceHeadless?: boolean             // required to headless 'login'
}
```

Example:

```bash
curl -s -X POST "$BASE/research-crawler/chrome/open" \
  -H 'Content-Type: application/json' \
  -d '{"profile":"login","url":"https://instagram.com"}'
```

Response: passthrough of `launchChrome()` result — `{ ok, url, port, ... }`.

## POST `/research-crawler/instagram/capture-profile`

Body:

```ts
{
  username?: string                   // pass username OR url
  url?: string
  chromeOrigin?: string               // e.g. http://127.0.0.1:9223
  remoteDebuggingPort?: number
  maxResponses?: number               // 1..200
  timeoutMs?: number
  includeRaw?: boolean
  openNewTab?: boolean
  scrollIntervalMs?: number           // 1..10000
  initialDelayMs?: number             // 0..10000
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

Refinement: must pass either `username` or `url`.

Example:

```bash
curl -s -X POST "$BASE/research-crawler/instagram/capture-profile" \
  -H 'Content-Type: application/json' \
  -d '{"username":"nasa","maxResponses":30,"profile":"public"}'
```

Response: `StandardCrawlerOutput` —

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

`meta.avgLikes` is a dominant-cluster mean, not a plain average (see `packages/research-crawler/src/core/instagram/avg-likes.ts`).

## POST `/research-crawler/instagram/discover`

Body:

```ts
{
  source?: 'explore' | 'hashtag' | 'keyword'
  hashtag?: string                    // required if source='hashtag'
  keyword?: string                    // required if source='keyword'
  chromeOrigin?: string
  remoteDebuggingPort?: number
  targetCompetitors?: number          // 1..200
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

Example:

```bash
curl -s -X POST "$BASE/research-crawler/instagram/discover" \
  -H 'Content-Type: application/json' \
  -d '{"source":"hashtag","hashtag":"spacephotography","targetCompetitors":25}'
```

Response shape mirrors `discoverInstagramCompetitors()` — simplified, not the standard envelope.

## Errors

- `400` — Zod validation (`error.issues`) including refinement failures ("Pass username or url.", "Pass hashtag when source is hashtag.").
- `500` — internal capture failure (network, CDP, parse). Inspect `error.message`.

## Workflows

Capture flow for an existing competitor is documented in `competitors.md` (it bundles capture + persistence). This file is for raw crawler calls.
