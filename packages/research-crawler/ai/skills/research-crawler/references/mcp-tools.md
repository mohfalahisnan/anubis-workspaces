# Research Crawler MCP Tools

## Server

Run the MCP server with the packaged executable:

```bash
research-crawler mcp
```

For local development:

```bash
node dist/cli.js mcp
```

## Tools

### `open_chrome`

Launches Chrome with remote debugging.

Inputs:

```json
{
  "url": "https://www.instagram.com/",
  "profile": "login",
  "profileDir": "data/chrome-profile",
  "remoteDebuggingPort": 9222,
  "chromePath": "optional explicit Chrome path",
  "headless": false
}
```

- `profile`: `"login"` (port 9222, logged-in), `"public"` (port 9223, anonymous), `"flow"` (port 9224, Google Flow).
- Omit `profileDir` to use the project default for the chosen profile.

---

### `capture_instagram_profile`

Captures Instagram profile and post data from Chrome DevTools network responses.

Inputs:

```json
{
  "username": "example",
  "chromeOrigin": "http://127.0.0.1:9222",
  "maxResponses": 30,
  "timeoutMs": 8000,
  "includeRaw": false,
  "openNewTab": false,
  "keepChromeOpen": false
}
```

- Use `username` **or** `url` (not both).
- Pass a post/reel permalink as `url` to capture a single post (e.g. `https://www.instagram.com/p/CODE/`).
- `maxResponses`: number of posts to collect (default 30).
- `openNewTab: true` when running multiple concurrent captures on the same Chrome instance.
- `keepChromeOpen: true` to leave Chrome running after capture (useful for chained calls).

---

### `discover_instagram_competitors`

Crawls Instagram Explore, hashtag, or keyword surfaces and returns profile candidates.

Inputs:

```json
{
  "source": "hashtag",
  "hashtag": "coffee",
  "chromeOrigin": "http://127.0.0.1:9222",
  "targetCompetitors": 20,
  "timeoutMs": 30000,
  "includeRaw": false,
  "keepChromeOpen": false
}
```

- `source`: `"explore"`, `"hashtag"`, or `"keyword"`.
- `hashtag`: required when `source` is `"hashtag"` (omit the leading `#`).
- `keyword`: required when `source` is `"keyword"`.
- `targetCompetitors`: stop after finding this many profiles (default 20).
- Use `profile: "login"` for better coverage — Explore and some hashtag surfaces require a logged-in session.

---

## Result envelope

All tools return one standard envelope:

```json
{
  "ok": true,
  "schemaVersion": "1.0",
  "outputTypes": ["Profile Data List", "Post Data List"],
  "input": {
    "target": "instagram",
    "mode": "profile_capture"
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

- `output.profiles` — Profile Data List (username, followers, bio, avgLikes, profileUrl, etc.).
- `output.posts` — Post Data List (url, likes, comments, caption, mediaType, etc.).
- `ok: false` includes an `error.code` + `error.message`; both lists are empty.
- Empty arrays can mean the page did not expose matching network responses before timeout — check `meta.warnings`.
- Use `includeRaw: true` only when the user needs trace/debug data.
