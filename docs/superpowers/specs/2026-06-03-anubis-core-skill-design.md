# Anubis Core Skill — Design Spec

**Date:** 2026-06-03
**Status:** Approved

## Goal

Project-scoped skill set that lets Claude operate the Anubis app — crawling,
CRUD, conversations, admin — by hitting the running backend's HTTP API,
without re-reading route source every time.

## Structure

Lives in the **Anubis app's own auto-inject skill root** so it shows up
in the in-app Skills tab and gets materialised into every spawned
agent's home dir alongside `cron-helper`:

```
packages/ai-agent/skills/auto-inject/anubis-core/
  SKILL.md            # parent: triggers, URL discovery, sub-file routing
  crawler.md          # /research-crawler/*
  competitors.md      # /competitors, /captures, /posts
  conversations.md    # /conversations, /ai-agent
  admin.md            # /profiles, /skills, /config, /cron-jobs, /system
```

`SkillLoader.walk` only discovers `dir/SKILL.md`; helper files in the
same dir are NOT registered as separate skills — they ride along when
`writeProfileSkills` does `cpSync(dirname(skill.path), dest, recursive)`.
So the agent sees them under `skills/anubis-core/<file>.md` relative to
its home, matching the pointer block emitted by
`packages/conversation/src/skills/inject.ts`.

## Parent SKILL.md

- **Frontmatter** — three fields matching the in-app loader's
  expectations (see `packages/conversation/src/skills/loader.ts:67-70`):
  `name`, `description` (one short sentence; appears on the Skills card),
  `when_to_use` (verbose trigger list — appears under "WHEN TO USE" on
  the same card).
- **Backend URL discovery** (the only non-obvious recipe): four ordered
  steps —
  1. `$env:VITE_API_BASE_URL` if set.
  2. Try `http://127.0.0.1:3000/health`; accept if `service` field is
     `anubis-backend`.
  3. Enumerate listening 127.0.0.1 TCP ports with `Get-NetTCPConnection`
     and probe `/health` on each. Match on the same `service` value.
  4. Ask the user. The port is OS-assigned per Electron run and not
     persisted anywhere on disk (verified against
     `apps/desktop/electron/main/backend.ts`).
- **Sub-file routing table** — one row per domain, telling Claude which
  sub-file to Read for a given intent.
- **Common envelope** — all routes return `{ ok: true, ... }` or
  `{ ok: false, error: ... }`. `ZodError` returns 400 with `issues`.

Target length: ~200 words.

## Sub-files (shared shape)

Each sub-file follows the same template:

1. **Endpoint table** — method, path, one-line purpose, source file:line.
2. **Per-endpoint section** — request schema as TypeScript (mirroring the
   Zod schema), PowerShell `Invoke-RestMethod` example, response shape,
   error codes specific to that route.
3. **Workflows** — multi-step recipes live where the user-facing intent
   starts. The "capture a competitor end-to-end" workflow lives in
   `competitors.md`, not `crawler.md`, because the user says "capture
   <handle>", not "open chrome then scrape".
4. **Source pointers** — `packages/backend/src/<file>.ts:LL` for each
   handler so I can jump straight to the implementation when the skill
   isn't enough.

## Source-of-truth mapping

| Sub-file | Backend module | Notable cross-references |
| --- | --- | --- |
| `crawler.md` | `research-crawler.ts` | `@anubis/research-crawler` (CDP); profile semantics — login=9222 headed, public=9223 headless, flow=9224 headed |
| `competitors.md` | `competitors.ts`, `captures.ts` | `avgLikes` is dominant-cluster mean per `core/instagram/avg-likes.ts` |
| `conversations.md` | `conversation.ts`, `ai-agent.ts` | SSE on `/conversations/:id/stream`; `NoCredentialsError` → 409 |
| `admin.md` | `profile.ts`, `skill.ts`, `config.ts`, `cron.ts`, `system.ts` | Profile login uses platform-native terminal spawn |

## Open items deferred

- No `ANUBIS_BACKEND_URL` env var injection into spawned agents. Step 1
  of URL discovery references `$ANUBIS_BACKEND_URL` so the user can opt
  in manually, but the conversation/ai-agent layer doesn't yet pass it
  via `extraEnv`. Future improvement: have the backend export its own
  URL into the agent run env.
- No `references/` subdirectory — four flat sub-files keep relative
  Read paths short.
- No mirror in `.claude/skills/` for Claude Code working on this repo —
  single source of truth in `packages/ai-agent/skills/auto-inject/`.
  If we later want Claude Code to load it too, the `.claude/` mirror or
  a symlink can be added.

## Out of scope

- Frontend, Electron main, or research-crawler library internals.
- Tests for the skill itself (these are reference docs, not behavioural
  skills — the writing-skills TDD loop is overkill here).
- Per-shell PowerShell/cmd/bash variants for every example. We pick
  `curl` (Windows 10+, macOS, Linux) as the lingua franca for examples,
  and only add a PowerShell sidenote where the shell mechanics matter
  (e.g. unmarshalling JSON without `jq`). Port-discovery in SKILL.md
  includes Windows / macOS / Linux variants because `Get-NetTCPConnection`
  isn't portable.
