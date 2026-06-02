---
name: research-crawler
description: Use this skill when the user wants browser-visible research crawling or scraping through the Research Crawler MCP server — Instagram profile/post capture, Instagram competitor discovery, opening Chrome with remote debugging, or setting up an AI assistant to use the packaged research-crawler executable.
---

# Research Crawler

Use the `research-crawler` MCP server for browser-visible Instagram data collection. Prefer MCP tools over shell commands when available.

## Tools

| Tool | Purpose |
|---|---|
| `open_chrome` | Launch Chrome with remote debugging enabled |
| `capture_instagram_profile` | Capture profile data and recent posts from one Instagram account |
| `discover_instagram_competitors` | Crawl Explore, hashtag, or keyword to find competitor profile candidates |

Read `references/mcp-tools.md` for exact input schemas and example calls.

## Workflow

### Capture a profile

1. Call `open_chrome` if no Chrome debug session is running. Use `profile: "login"` for a logged-in session, `profile: "public"` for anonymous.
2. Call `capture_instagram_profile` with `username` or `url`.
3. Return results from `output.profiles` (profile metadata) and `output.posts` (recent posts). Summarize counts and warnings; do not invent missing fields.

### Discover competitors

1. Call `open_chrome` with `profile: "login"` — discovery works better on a logged-in session.
2. Choose a source:
   - `source: "hashtag"` + `hashtag: "coffee"` — profiles that posted on a hashtag.
   - `source: "keyword"` + `keyword: "kopi susu"` — keyword search.
   - `source: "explore"` — Instagram Explore feed (no keyword needed).
3. Call `discover_instagram_competitors` with the chosen source and `targetCompetitors` count.
4. Return candidates from `output.profiles`. Each candidate has `username`, `followers`, `bio`, and `profileUrl`.

### Multi-profile capture

Run `capture_instagram_profile` once per username with `openNewTab: true` after the first call so all captures share the same Chrome instance.

## Result envelope

All tools return:

```json
{
  "ok": true,
  "schemaVersion": "1.0",
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

- `ok: false` includes an `error` object; both arrays are empty.
- Empty arrays mean the page did not expose matching network responses before timeout.
- Use `includeRaw: true` only for trace/debug; otherwise summarize `output.profiles`, `output.posts`, and `meta.warnings`.

## Safety

- Only collect data visible to the user's browser session.
- Do not ask users for passwords or session cookies.
- Do not bypass login, paywalls, rate limits, or access controls.
- Keep outputs factual: distinguish captured records from inferences.
