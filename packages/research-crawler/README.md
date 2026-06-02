# Research Crawler

Headless extraction of the browser scraping/crawling core from Orchapp. It has no UI and no local HTTP server: the CLI calls the crawler functions directly.

## Install

```bash
pnpm install
pnpm build
```

## Pack

Build a standalone executable for the current OS:

```bash
pnpm run pack:sea
```

Output:

```text
release/research-crawler.exe   # Windows
release/research-crawler       # macOS/Linux
```

The executable embeds Node and does not require Node.js on the user's machine. Build macOS and Linux binaries on macOS/Linux runners; Node SEA uses the current platform's Node binary.

## CI/CD

GitHub Actions workflows:

- `.github/workflows/ci.yml` runs typecheck, build, executable packing, CLI smoke test, and artifact upload on Ubuntu, macOS, and Windows.
- `.github/workflows/release.yml` builds packaged binaries on tags like `v0.1.0`, archives them, and uploads assets to the GitHub Release.

Create a release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

## CLI

```bash
pnpm research-crawler --help
release/research-crawler.exe --help

# Open Chrome with a named profile (login, public, or flow)
pnpm research-crawler open-chrome --profile login
pnpm research-crawler open-chrome --profile public --headless

# Capture posts for one or many usernames on the public profile (default)
pnpm research-crawler capture-instagram-profile --username example --posts-per-profile 30
pnpm research-crawler capture-instagram-profile --usernames a,b,c --posts-per-profile 20
pnpm research-crawler capture-instagram-profile --from-file data/discover.json --posts-per-profile 30

# Capture a single post or reel by permalink
pnpm research-crawler capture-instagram-post --post-url https://www.instagram.com/p/CODE/

# Discover competitor profiles on the login profile (default)
pnpm research-crawler discover-instagram --source hashtag --hashtag coffee --target-competitors 20

# Generate images in Google Flow from the flow profile
pnpm research-crawler flow-generate "product photo on a kitchen counter" \
  --url "https://labs.google/fx/id/tools/flow/project/<project-id>" \
  --ratio 1:1 --variations 4 --download-dir result/flow
```

After build, package bins are:

```bash
research-crawler
rcrawl
```

Chrome must run with remote debugging enabled. `open-chrome` starts a separate Chrome profile with `--remote-debugging-port`.

### Profiles

Three Chrome profiles are kept side-by-side:

| Profile | Default dir                    | Default port | Default headless |
|---------|--------------------------------|--------------|------------------|
| login   | `data/chrome-profile-login`    | 9222         | headed           |
| public  | `data/chrome-profile-public`   | 9223         | headless         |
| flow    | `data/chrome-profile-flow`     | 9224         | headed           |

`open-chrome --profile login` opens a visible Chrome — log in to Instagram once and close. Subsequent `discover-instagram` runs reuse that session. The public profile is used for raw post capture (`capture-instagram-profile`, `capture-instagram-post`).

`flow-generate` defaults to the `flow` profile and launches/reuses that Chrome automatically. Pass `--url "https://labs.google/fx/id/tools/flow/project/<project-id>"` on the first run, log in to Google manually if prompted, then rerun the same command.

`--headless` and `--headed` override the default. The login profile refuses headless unless `--force-headless` is passed, since you cannot complete the login flow without a visible window.

If a Chrome is already listening on the resolved port for the same profile dir, it is reused instead of spawned. A mismatched profile dir on that port is rejected.

### Progress

`discover-instagram` and `capture-instagram-profile` stream progress lines to stderr while running:

```
[discover] started target=20
[discover] 3/20 candidates
[capture:userA] 12/30 responses
```

Pass `--quiet` to silence stderr progress (stdout JSON is unaffected).

## Standard Data Contract

The MCP `capture_instagram_profile` tool and the `capture-instagram-post` command return the full JSON envelope:

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

Use `--include-raw` or MCP `includeRaw: true` only when debugging source responses.

Some commands return a simplified shape instead of the envelope:

`discover-instagram`:

```json
{
  "profiles": [{ "username": "example", "followers": 12345, "bio": "..." }],
  "total": 1,
  "target": 20
}
```

`capture-instagram-profile` (`total` = number of posts):

```json
{
  "profiles": [{ "username": "example", "followers": 12345, "bio": "...", "avgLikes": 150 }],
  "posts": [{ "postUrl": "...", "username": "example", "likes": 200, "comments": 5, "timestamp": "...", "caption": "...", "media": {} }],
  "total": 30
}
```

`setup-avg-likes` (`total` = number of profiles):

```json
{
  "profiles": [{ "username": "example", "followers": 12345, "bio": "...", "avgLikes": 150 }],
  "total": 1
}
```

`avgLikes` is the **dominant-cluster mean**: posts are grouped so that like counts within ~2× of a neighbour share a cluster; the largest cluster's mean is reported. This reflects the engagement *most* posts get and prevents a few viral posts from inflating the figure (e.g. 7 posts @100–200, 3 @500, 2 @3200 → `avgLikes` 150). When likes are smooth (no jump larger than 2×), it equals the overall mean. `capture-instagram-post` keeps the full envelope.

## MCP

Run the stdio MCP server:

```bash
pnpm research-crawler mcp
```

Example MCP client config:

```json
{
  "mcpServers": {
    "research-crawler": {
      "command": "D:/workspaces/coding/projects/research-crawler/release/research-crawler.exe",
      "args": ["mcp"]
    }
  }
}
```

Tools:

- `open_chrome`
- `capture_instagram_profile`

## AI Client Setup

Copy-ready setup files live in [ai/](ai/):

- [ai/README.md](ai/README.md) explains user setup.
- [ai/mcp/](ai/mcp/) contains MCP config snippets for Windows, macOS, Linux, and local development.
- [ai/skills/research-crawler](ai/skills/research-crawler) contains a portable AI skill that tells assistants when and how to use the MCP tools.
