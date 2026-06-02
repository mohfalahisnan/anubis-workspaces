# Research Crawler

`research-crawler` is the internal Chrome DevTools Protocol crawler library used by
the Anubis backend. It has no local HTTP server, no MCP server, and no standalone
binary packaging. The backend imports the package directly and exposes the HTTP API.

## Install

From the repository root:

```bash
pnpm install
pnpm --filter research-crawler build
pnpm --filter research-crawler typecheck
```

## Backend Usage

Use the Anubis backend routes instead of calling this package over a separate
server:

- `POST /research-crawler/chrome/open`
- `POST /research-crawler/instagram/capture-profile`
- `POST /research-crawler/instagram/discover`

The package exports crawler functions from `src/index.ts` for backend use.

## Chrome Profiles

Chrome must run with remote debugging enabled. The backend can open or reuse
Chrome profiles through `/research-crawler/chrome/open`.

Three Chrome profiles are kept side by side:

| Profile | Default dir | Default port | Default headless |
| ------- | ----------- | ------------ | ---------------- |
| `login` | `data/chrome-profile-login` | `9222` | headed |
| `public` | `data/chrome-profile-public` | `9223` | headless |
| `flow` | `data/chrome-profile-flow` | `9224` | headed |

The `login` profile opens visible Chrome so Instagram login can be completed
manually. The `public` profile is used for raw Instagram post/profile capture.
The `flow` profile is used for Google Flow automation.

`--headless` and `--headed` style options are still supported by the core launch
API. The login profile refuses headless unless `forceHeadless` is passed because
the login flow needs a visible browser.

If Chrome is already listening on the resolved port for the same profile dir, the
crawler reuses it. A mismatched profile dir on that port is rejected.

## Progress

Crawler services accept a progress reporter. The backend passes `silentReporter()`
so HTTP responses stay clean. Tests and local scripts can pass a reporter to see
progress such as:

```text
[discover] started target=20
[discover] 3/20 candidates
[capture:userA] 12/30 responses
```

## Standard Data Contract

Profile capture returns the full JSON envelope:

```json
{
  "ok": true,
  "schemaVersion": "1.0",
  "outputTypes": ["Profile Data List", "Post Data List"],
  "input": {
    "target": "instagram",
    "mode": "profile_capture",
    "username": "example",
    "chromeOrigin": "http://127.0.0.1:9222",
    "maxResponses": 30
  },
  "output": {
    "profiles": [],
    "posts": []
  },
  "meta": {
    "profileCount": 0,
    "postCount": 0,
    "warnings": []
  }
}
```

Output list types:

- `Profile Data List` is stored in `output.profiles`.
- `Post Data List` is stored in `output.posts`.

Use `includeRaw: true` only when debugging source responses.

Some services return simplified shapes:

`discoverInstagramCompetitors`:

```json
{
  "profiles": [{ "username": "example", "followers": 12345, "bio": "..." }],
  "total": 1,
  "target": 20
}
```

`captureInstagramData`:

```json
{
  "profiles": [{ "username": "example", "followers": 12345, "bio": "...", "avgLikes": 150 }],
  "posts": [{ "postUrl": "...", "username": "example", "likes": 200, "comments": 5, "timestamp": "...", "caption": "...", "media": {} }],
  "total": 30
}
```

`avgLikes` is the dominant-cluster mean: posts are grouped so like counts within
roughly 2x of a neighbour share a cluster, and the largest cluster's mean is
reported. This reflects the engagement most posts get and prevents a few viral
posts from inflating the figure.
