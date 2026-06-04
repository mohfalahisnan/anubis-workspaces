# Admin — profiles, skills, config, cron, system

## Endpoints

| Method | Path | Purpose | Source |
| --- | --- | --- | --- |
| GET | `/profiles` | List profiles (each enriched with `home` info) | `profile.ts:48` |
| GET | `/profiles/:id` | Get one (404 if missing) | `profile.ts:53` |
| POST | `/profiles` | Create | `profile.ts:59` |
| POST | `/profiles/:id/copy` | Duplicate a profile (incl. agent home) | `profile.ts:70` |
| PATCH | `/profiles/:id` | Edit name/description/configPatch/sortOrder | `profile.ts:80` |
| DELETE | `/profiles/:id` | Delete | `profile.ts:86` |
| POST | `/profiles/:id/resolve` | Resolve the merged config the agent would actually use | `profile.ts:91` |
| POST | `/profiles/:id/login/terminal` | Open a native terminal that runs `<agent> login` in the profile's isolated home | `profile.ts:102` |
| POST | `/profiles/:id/reset-home` | Wipe the profile's agent home directory | `profile.ts:164` |
| GET | `/skills` | List every discovered skill (auto + opt-in + user) | `skill.ts:15` |
| GET | `/skills/:name` | Get one skill by name (404 if missing) | `skill.ts:45` |
| POST | `/skills/import` | Import a skill from a folder or zip | `skill.ts:20` |
| POST | `/skills/reload` | Re-scan all skill sources | `skill.ts:51` |
| GET | `/config` | Get app config | `config.ts:28` |
| PATCH | `/config` | Patch app config (empty strings unset) | `config.ts:32` |
| GET | `/cron-jobs` | List, optionally `?conversationId=` filter | `cron.ts:15` |
| PATCH | `/cron-jobs/:id` | Edit name/schedule/prompt/enabled | `cron.ts:20` |
| DELETE | `/cron-jobs/:id` | Delete | `cron.ts:27` |
| GET | `/system/chrome-profiles` | Walk OS Chrome user-data dir, list profiles + emails | `system.ts:141` |

## Profiles

### POST `/profiles`

```ts
{
  name: string                           // required
  description?: string
  config: {
    agent: 'claude' | 'codex'            // required
    // arbitrary additional keys allowed (passthrough)
  }
}
```

### PATCH `/profiles/:id`

```ts
{
  name?: string
  description?: string
  configPatch?: Record<string, unknown>  // shallow merged into config
  sortOrder?: number                     // int
}
```

### POST `/profiles/:id/copy`

```ts
{ name: string, description?: string }
```

Creates a new profile and copies the source profile's agent home directory.

### POST `/profiles/:id/resolve`

```ts
{ override?: Record<string, unknown> }   // empty body OK
```

Returns `{ ok: true, resolved }` — the actual config that would be passed to the agent given the profile + the override.

### POST `/profiles/:id/login/terminal`

No body. Spawns a platform-native terminal (`cmd /k` on Windows, `Terminal.app` on macOS, `x-terminal-emulator` on Linux) inside the profile's isolated agent home and runs `<agent> login`.

Notes:

- Deduped within 3 seconds per profile id — repeat calls return `{ ok: true, deduped: true }`.
- Returns `409 { code: 'agent_not_installed' }` if the agent CLI isn't on PATH.
- Returns 404 if the profile id is unknown.

### POST `/profiles/:id/reset-home`

No body. Wipes the agent home dir. Response includes `existed: boolean`.

## Skills

### POST `/skills/import`

```ts
{
  sourcePath: string                     // absolute path on user's machine
  kind: 'folder' | 'zip'
  category: 'auto' | 'opt-in' | 'user'
}
```

Response on success: `{ ok: true, name, source, count }`. On bad source: `400 { ok: false, error: <message> }`.

`POST /skills/reload` returns `{ ok: true, count }` after rescanning.

## Config

```ts
// PATCH /config body
{
  chromePath?: string                    // empty string = unset
  crawlerProfileRoot?: string            // empty string = unset
}
```

`GET /config` returns the persisted config; the capture + discover handlers read it before each crawler call, so changes take effect with no restart.

## Cron jobs

```ts
// PATCH /cron-jobs/:id body
{
  name?: string
  schedule?: string                      // cron expression
  scheduleDescription?: string
  prompt?: string
  enabled?: boolean
}
```

There is no create route — cron jobs are spawned by the conversation/agent runtime. Use PATCH to edit and DELETE to remove.

## System

`GET /system/chrome-profiles` returns:

```ts
{
  ok: boolean                            // false when standard user-data dir doesn't exist
  userDataDir: string | null
  profiles: {
    directory: string                    // 'Default' or 'Profile N'
    name: string                         // friendly name from Local State
    path: string                         // absolute
    email?: string
  }[]
}
```

Use this to populate the "which Chrome profile to use for login=9222" picker before opening Chrome via `crawler.md`.

## Errors

Standard envelope from `app.ts:52-71`:

- `400` ZodError with `issues`.
- `404` `{ ok: false, error: 'not_found' }` for any `/:id` lookup miss.
- `409` for `no_credentials` (conversations) and `agent_not_installed` (profile terminal login).
- `500` for internal errors with `error.message`.
