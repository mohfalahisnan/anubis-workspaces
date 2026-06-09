# Admin — profiles, skills, config, workspaces, system

Plumbing. Setup the user does once.

## Auth model per agent

| Agent | Env var | Credential | Isolated per profile? |
| --- | --- | --- | --- |
| `claude` | `CLAUDE_CONFIG_DIR` | `<home>/.credentials.json` | Yes |
| `codex` | `CODEX_HOME` | `<home>/auth.json` | Yes |
| `antigravity` | `GEMINI_DIR` | OS keyring | Config yes, **login shared** |
| `gpt-web`, `qwen-web` | — | Chrome `login` profile cookies (port 9222) | No |

`hasCredentials` returns `true` unconditionally for `antigravity` / `gpt-web` / `qwen-web` — no on-disk marker.

## Routes — profiles

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/profiles` | List, each enriched with `home` |
| GET | `/profiles/:id` | Get |
| POST | `/profiles` | Create |
| POST | `/profiles/:id/copy` | Duplicate (incl. home dir) |
| PATCH | `/profiles/:id` | Edit |
| DELETE | `/profiles/:id` | Delete |
| POST | `/profiles/:id/resolve` | Resolve merged config |
| POST | `/profiles/:id/login/terminal` | Open native terminal running `<agent> login` |
| POST | `/profiles/:id/reset-home` | Wipe home dir |

## Routes — skills

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/skills` | List |
| GET | `/skills/:name` | Get |
| POST | `/skills/import` | Import folder/zip |
| POST | `/skills/reload` | Re-scan |

## Routes — config

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/config` | Get |
| PATCH | `/config` | Patch |

## Routes — workspaces

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/workspaces` | List remembered workdirs |
| DELETE | `/workspaces` | Forget (path in body) |

## Routes — system

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/system/chrome-profiles` | Walk OS Chrome user-data dir |

## POST /profiles

```ts
{
  name: string
  description?: string
  config: {
    agent: 'claude'|'codex'|'antigravity'|'gpt-web'|'qwen-web'
    // additional keys passthrough
  }
}
```

## PATCH /profiles/:id

```ts
{ name?, description?, configPatch?: Record<string, unknown>, sortOrder?: number }
```

`configPatch` is shallow-merged.

## POST /profiles/:id/copy

```ts
{ name: string, description? }
```

Copies the home dir (file-based agents only — keyring/cookies stay global).

## POST /profiles/:id/resolve

```ts
{ override?: Record<string, unknown> }   // empty body OK
```

Returns `{ ok: true, resolved }` — actual config the agent would receive.

## POST /profiles/:id/login/terminal

No body. Spawns terminal in isolated home running `<agent> login`.

- Deduped within 3s — repeat → `{ ok: true, deduped: true }`.
- `409 { code: 'agent_not_installed' }` — CLI not on PATH.
- `400` for `gpt-web` / `qwen-web` — log in via browser instead.
- 404 if profile unknown.

After firing, tell user "I opened a terminal — finish login and tell me when done." You can't detect completion.

## POST /profiles/:id/reset-home

⚠️ Destructive. Confirm before firing. Wipes credentials + state. For `antigravity` only wipes config, NOT keyring login.

## POST /skills/import

```ts
{
  sourcePath: string                   // absolute
  kind: 'folder' | 'zip'
  category: 'auto' | 'opt-in' | 'user'
}
```

After import or reload, also `POST /conversations/:id/reset-skills` so the current chat sees them.

## PATCH /config

```ts
{
  chromePath?: string                  // "" = unset
  crawlerProfileRoot?: string          // "" = unset
  competitorLevels?: {
    minActive: number, greenMax: number, yellowMax: number, maxActive: number
  }
  levelMultipliers?: {
    green:  { min: number, good: number }
    yellow: { min: number, good: number }
    red:    { min: number, good: number }
  }
}
```

Crawler reads on every call — no restart needed.

## DELETE /workspaces

```ts
{ path: string }                       // body, not URL
```

Removes from picker history. Does not touch filesystem.

## GET /system/chrome-profiles

```ts
{
  ok: boolean                          // false if user-data dir missing
  userDataDir: string|null
  profiles: Array<{ directory, name, path, email? }>
}
```

Use `email` to disambiguate when offering choices to the user.

## Example

```bash
PROFILE_ID=$(curl -s -X POST "$BASE/profiles" -H 'Content-Type: application/json' \
  -d '{"name":"Codex - main","config":{"agent":"codex"}}' | jq -r .profile.id)
curl -s -X POST "$BASE/profiles/$PROFILE_ID/login/terminal"
```
