# Admin — profiles, skills, config, workspaces, system

This file covers the **plumbing**: agent profiles (which CLI + credentials), the skill registry, app config, remembered workspace paths, and the OS Chrome profile listing. If you're orchestrating workflows or chats, you're in `workflows.md` / `conversations.md`. This file is for the setup the user does *once* (or now and then).

## When to use this file

- "List my profiles" / "Make a Codex profile."
- "Open a login terminal for this profile" / "Reset this profile's home."
- "Copy this profile" — duplicate with its agent home.
- "Resolve what config the agent would actually use."
- "Import this skill folder / zip."
- "Reload skills — I just dropped a new one in."
- "Show me my app config" / "Set chromePath."
- "What workspaces have I opened?" / "Forget this workspace."
- "Which Chrome profiles do I have on this machine? I need to pick one for login."

## Mental model — agent profiles

A **profile** is an agent identity. It bundles:

- `name`, `description` (free text the user owns),
- `config.agent` — one of `claude | codex | antigravity | gpt-web` (required),
- arbitrary additional `config.*` keys passed straight through to the agent runner,
- a `home` (`{ path, exists, hasCredentials }`) — the isolated directory where the agent's credentials/state live.

The `home` is included on every list/get response so the UI can show "logged in? ✅/❌" without an extra call. If `hasCredentials` is false, sending a message in a conversation that uses this profile will return `409 no_credentials` (see `conversations.md`) — fix it by spawning a login terminal.

Profile config flows through three layers, low to high precedence: **profile.config → conversation.override → message.override**. `POST /profiles/:id/resolve` shows you the actual merged result, useful when the user asks "what would this profile actually do?".

## Mental model — skills

A **skill** is a folder with a SKILL.md that documents capabilities for the agent. Three categories control how they get injected:

- `auto` — auto-injected into every conversation.
- `opt-in` — available, but injected only when explicitly chosen.
- `user` — user-imported, treated like opt-in.

Importing or moving files in the filesystem doesn't auto-pick-up — call `POST /skills/reload` to rescan all sources.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/profiles` | List (each enriched with `home`) |
| GET | `/profiles/:id` | Get one (404) |
| POST | `/profiles` | Create |
| POST | `/profiles/:id/copy` | Duplicate, including agent home |
| PATCH | `/profiles/:id` | Edit name/description/configPatch/sortOrder |
| DELETE | `/profiles/:id` | Delete |
| POST | `/profiles/:id/resolve` | Resolve the merged config the agent would use |
| POST | `/profiles/:id/login/terminal` | Open native terminal running `<agent> login` |
| POST | `/profiles/:id/reset-home` | Wipe the profile's agent home |
| GET | `/skills` | List discovered skills (auto + opt-in + user) |
| GET | `/skills/:name` | Get one (404) |
| POST | `/skills/import` | Import from folder or zip |
| POST | `/skills/reload` | Re-scan all sources |
| GET | `/config` | Get app config |
| PATCH | `/config` | Patch app config (empty strings unset) |
| GET | `/workspaces` | List remembered workspace paths |
| DELETE | `/workspaces` | Forget a workspace by path (body) |
| GET | `/system/chrome-profiles` | Walk the OS Chrome user-data dir |

All bodies `.strict()` unless noted otherwise.

## Profiles

### POST `/profiles`

```ts
{
  name: string                                    // required
  description?: string
  config: {
    agent: 'claude' | 'codex' | 'antigravity' | 'gpt-web'   // required
    // additional keys allowed (passthrough)
  }
}
```

### PATCH `/profiles/:id`

```ts
{
  name?: string
  description?: string
  configPatch?: Record<string, unknown>           // shallow merged into config
  sortOrder?: number                              // int
}
```

`configPatch` is shallow-merged — to delete a key you need to overwrite it with the desired final shape (the route does not honour `null` as a delete sentinel).

### POST `/profiles/:id/copy`

```ts
{ name: string, description?: string }
```

Creates a new profile *and copies its agent home directory*. Useful when the user wants a sandboxed clone (e.g. "give me a copy of my main Codex setup so I can experiment").

### POST `/profiles/:id/resolve`

```ts
{ override?: Record<string, unknown> }            // empty body OK
```

Returns `{ ok: true, resolved }` — the actual config the agent would receive. Use this for "what would this profile run with?" diagnostic questions.

### POST `/profiles/:id/login/terminal`

No body. Spawns a platform-native terminal inside the profile's isolated agent home and runs `<agent> login`:

- Windows: `cmd /k`
- macOS: `Terminal.app`
- Linux: `x-terminal-emulator`

Notes:

- **Deduped** within ~3 seconds per profile id — repeat calls return `{ ok: true, deduped: true }`. Tell the user "I already opened one a moment ago".
- `409 { code: 'agent_not_installed' }` — the agent CLI isn't on PATH. Surface this verbatim; user has to install the CLI themselves.
- 404 if the profile id is unknown.

After firing this, your conversation has *no way* to know when the user has finished logging in. Tell them: "I opened a terminal — finish the login and let me know when you're done."

### POST `/profiles/:id/reset-home`

No body. Wipes the agent home dir for this profile (credentials, cached state, everything). Response includes `existed: boolean`. **Confirm with the user before firing.** This is destructive and undoes any login.

## Skills

### POST `/skills/import`

```ts
{
  sourcePath: string                              // absolute path on user's machine
  kind: 'folder' | 'zip'
  category: 'auto' | 'opt-in' | 'user'
}
```

Response on success: `{ ok: true, name, source, count }`. Bad source: `400 { ok: false, error: <message> }`.

### POST `/skills/reload`

No body. Returns `{ ok: true, count }`. Use after the user has edited skill files on disk and wants the agent to pick them up without restarting the app.

After importing or reloading, also call `POST /conversations/:id/reset-skills` (see `conversations.md`) on the current conversation so it picks up the new skill index.

## Config

```ts
// PATCH /config body — all optional
{
  chromePath?: string                             // empty string = unset
  crawlerProfileRoot?: string                     // empty string = unset

  competitorLevels?: {
    minActive: number                             // int > 0
    greenMax: number                              // int > 0
    yellowMax: number                             // int > 0
    maxActive: number                             // int > 0
  }
  levelMultipliers?: {
    green:  { min: number, good: number }
    yellow: { min: number, good: number }
    red:    { min: number, good: number }
  }
}
```

`GET /config` returns the persisted config. The capture + discover handlers read it before each crawler call, so changes take effect immediately — no restart needed.

- `chromePath` — absolute path to a Chrome binary the crawler should use (otherwise it uses the bundled detection logic).
- `crawlerProfileRoot` — override the user-data-dir root for the three CDP profiles (`login`/`public`/`flow`).
- `competitorLevels` / `levelMultipliers` — thresholds for the colour-coded `level` system the UI uses to grade competitors (`black`/`green`/`yellow`/`red`). The user usually edits these in Settings; only touch them on explicit request.

```bash
# Set Chrome path
curl -s -X PATCH "$BASE/config" \
  -H 'Content-Type: application/json' \
  -d '{"chromePath":"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}'

# Clear it
curl -s -X PATCH "$BASE/config" \
  -H 'Content-Type: application/json' \
  -d '{"chromePath":""}'
```

## Workspaces

A **workspace** is a remembered cwd path the user has used for a conversation. The list lets the UI offer recent workdirs in the picker.

### GET `/workspaces`

No params. Returns `{ ok: true, items: [{ path, lastUsedAt }] }`.

### DELETE `/workspaces`

Takes a JSON body — not the more usual id-in-path:

```ts
{ path: string }                                  // min length 1, required
```

```bash
curl -s -X DELETE "$BASE/workspaces" \
  -H 'Content-Type: application/json' \
  -d '{"path":"/old/path/to/forget"}'
```

Forgetting a workspace doesn't touch the filesystem — it only removes the entry from the picker history.

## System

### GET `/system/chrome-profiles`

Walks the OS-standard Chrome user-data directory and lists the profiles it finds:

```ts
{
  ok: boolean                                     // false if the dir doesn't exist
  userDataDir: string | null
  profiles: Array<{
    directory: string                             // 'Default' or 'Profile N'
    name: string                                  // friendly name from Local State
    path: string                                  // absolute path to this profile
    email?: string                                // Google account email if signed-in
  }>
}
```

Use this when the user wants to choose which Chrome profile to use for `crawler.md` → `chrome/open` on `profile: 'login'`. The `email` field is what the user actually recognises ("the one with my @work.com email"), so prefer it when summarising the list.

## Workflows the user actually asks for

### "Make me a Codex profile and log it in"

```bash
PROFILE_ID=$(curl -s -X POST "$BASE/profiles" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Codex - main","config":{"agent":"codex"}}' \
  | jq -r .profile.id)

curl -s -X POST "$BASE/profiles/$PROFILE_ID/login/terminal"
# → "I opened a terminal running `codex login`. Tell me when you're done."
```

### "What chats can this profile actually drive?"

1. `GET /profiles/$ID` — check `home.hasCredentials`. If false, the answer is "none until you log in".
2. `POST /profiles/$ID/resolve` with no override — see what config the agent will receive.
3. If they want to reroute an existing chat, see `conversations.md` → PATCH `profileId`.

### "Reload skills after I dropped a new one in"

```bash
curl -s -X POST "$BASE/skills/reload"
# Then, for the current chat:
curl -s -X POST "$BASE/conversations/$CONV_ID/reset-skills"
```

### "Set Chrome to my system install"

```bash
# Find candidates the user has
curl -s "$BASE/system/chrome-profiles"

# Set the binary (path, not profile dir)
curl -s -X PATCH "$BASE/config" \
  -H 'Content-Type: application/json' \
  -d '{"chromePath":"<absolute path to Chrome binary>"}'
```

### "Clean slate this profile"

⚠️ Destructive — always confirm first.

```bash
curl -s -X POST "$BASE/profiles/$PROFILE_ID/reset-home"
```

After this the profile has no credentials. The next conversation send on it will return `409 no_credentials` and you'll re-run the login flow.
