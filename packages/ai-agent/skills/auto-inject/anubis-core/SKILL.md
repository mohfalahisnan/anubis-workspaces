---
name: anubis-core
description: How to act on the user's Anubis content workspace — discover and capture Instagram competitors, manage projects and content drafts, drive workflows and Chrome, run agent conversations, and edit app config — by calling the local Anubis backend HTTP API.
when_to_use: Trigger any time the user asks you to *do something inside their Anubis app* rather than answer a general question. Concrete signals — "add @nasa as a competitor", "capture more posts for X", "list this project's competitors", "create a content draft from this post", "sync metrics on the published post", "run the workflow", "what's in my backlog", "open Chrome for login", "switch to the codex profile", "edit my config", etc. If the user mentions a handle, a project name, a post, a workflow, a content draft, a task, a cron, or any object they can see in the app's UI, you are almost certainly meant to act on it via this skill.
---

# Anubis Core

You are running *inside* the user's Anubis desktop app. The app is a single Electron process that ships its own local backend (a Hono HTTP server). Your job, when the user gives you an actionable request, is to **drive that backend on their behalf** rather than describe what they could do manually.

This SKILL.md tells you (1) how to find the backend, (2) the mental model of the data, and (3) which sub-file to read for a given user intent. Do not memorise endpoints from this file — open the sub-file when you need to call something.

## Mental model — read this before anything else

Everything in Anubis lives inside a **project**. There is always a `default` project; named projects are added by the user. Most list endpoints accept `?projectId=` to scope results, and most create endpoints accept an optional `projectId` (omitted → `default`).

Inside a project:

- **Competitors** are Instagram handles the user tracks. They have stats (`followers`, `avgLikes`, `postCount`) and a colour-coded `level` (`black` > `green` > `yellow` > `red`) the user assigns.
- **Captured posts** are scraped from those competitors via the CDP crawler. The `/posts` feed joins each post back to its competitor (handle, tint, level, avg-likes).
- **Content items** are the user's *own* drafts/published pieces. Each one references either a captured post or an arbitrary URL, and moves through a lifecycle: `idea → brief → draft → review → scheduled → published → rejected`. After publishing, you can sync analytics from the public URL.
- **Tasks** are generic to-dos (backlog/todo/in_progress/in_review/done, priority, optional assignee profile).
- **Workflows** are node-graphs the user has built in the workflow editor. They have a `draft` and a `published` graph, can be **armed** to fire on schedule or file-watch triggers, and stream live events when they run.
- **Cron jobs** are recurring prompts spawned by the conversation/agent runtime (not directly by you).

Outside any project:

- **Conversations** are threaded chats; you may already be inside one. They can be `manual` (the user started them) or `workflow` (spawned by a workflow run).
- **Profiles** decide which agent CLI is invoked (`claude`, `codex`, `antigravity`, `gpt-web`) and which credentials/home are used.
- **Workspaces** are remembered cwd paths the user has opened.
- **Chrome profiles** (login=9222, public=9223, flow=9224) are the three CDP browser instances the crawler uses.

Keep this map in your head. When the user says "the @nasa post I just saved", they mean a captured post → likely the next step is a content item referencing it.

## Defaults to assume unless the user says otherwise

- `projectId` — if the conversation has been operating on a specific project, reuse it. Otherwise let the backend default to `default`.
- Capture `profile` — `public` (anonymous, headless). Only fall back to `login` if a capture failed with auth warnings, or the user explicitly asks for their logged-in identity, or the target appears to be private/follower-gated.
- Content item `status` — `idea` for new drafts unless the user is clearly past that stage.
- Workflow run — always start with the *published* graph; warn if the draft is ahead.

## When in doubt, list before you act

If the user references something by name ("the spacephotography workflow", "the post from yesterday"), do a list call first and pick the matching id. Never invent ids. Never assume a competitor / content item / workflow exists — listing is cheap.

## 1. Find the backend URL

The backend writes its URL to a well-known file at startup. Read that file — it's a single line containing `http://127.0.0.1:<port>`.

**Windows (PowerShell):**
```powershell
$portFile = "$env:LOCALAPPDATA\Anubis\anubis\backend.port"
$env:BASE = if (Test-Path $portFile) { Get-Content $portFile -Raw } else { 'http://127.0.0.1:4317' }
$env:BASE = $env:BASE.Trim()
```

**macOS/Linux (bash/zsh):**
```bash
portFile="${XDG_DATA_HOME:-$HOME/.local/share}/anubis/backend.port"
BASE=$([ -f "$portFile" ] && cat "$portFile" || echo 'http://127.0.0.1:4317')
export BASE
```

If the file doesn't exist (backend not yet started, or started before v2.6.4), fall back to:

1. `$ANUBIS_BACKEND_URL` env var.
2. `$VITE_API_BASE_URL` env var.
3. Probe `http://127.0.0.1:4317/health`; accept if `service === "anubis-backend"`.
4. Ask the user for the port.

CORS only allows localhost origins. Always hit `127.0.0.1` or `localhost`.

## 2. Route the user's intent to the right sub-file

| User said something like… | Read |
| --- | --- |
| add/list/delete competitor, capture posts for them, browse the post feed, import posts | `competitors.md` |
| create a draft from this post, change status to scheduled/published, sync metrics, list projects, create a project | `content.md` |
| add a to-do, show my backlog, mark task done, reassign, link a workflow to a task | `tasks.md` |
| run / arm / publish / edit / import / export a workflow, watch a workflow run, list / edit / delete cron jobs | `workflows.md` |
| open Chrome, capture an Instagram profile raw, discover new handles by hashtag/keyword/explore | `crawler.md` |
| start a chat, send a message, stream agent events, switch agent profile, reset skills, list workflow-spawned chats | `conversations.md` |
| list/login/reset agent profiles, import a skill, edit app config, inspect OS Chrome profiles, list/forget workspace paths | `admin.md` |

Open the sub-file before crafting the request body. Don't guess schemas — they're strict (Zod `.strict()`) and reject unknown keys.

## 3. Response envelope

Every route returns one of:

- **Success:** `{ ok: true, ...payload }` (2xx). Workflow endpoints sometimes return the bare object instead — sub-files note this.
- **Validation error:** `{ ok: false, error: { code: "BAD_REQUEST", message, issues } }` (400) — `issues` is the Zod issues array; surface its `path` and `message` to the user, don't dump raw JSON.
- **Domain error:** `{ ok: false, error: { code, message, ... } }` (4xx/5xx). The two you'll see most:
  - `409 no_credentials` on conversation send — the profile's agent CLI has never been logged in. Route the user to `admin.md` → `POST /profiles/:id/login/terminal`.
  - `409 agent_not_installed` on profile-login terminal — the agent CLI isn't on PATH. Tell the user to install it.

## 4. Calling the API

`curl` ships with Windows 10+ (`curl.exe`), macOS, and every modern Linux. Use it for one-shots. For SSE streams (workflow runs, conversation events), use `curl --no-buffer "$BASE/..."` — it works cross-platform and prints events as they arrive (Ctrl-C to stop).

```bash
curl -s "$BASE/competitors?projectId=$PID"
curl -s -X POST "$BASE/competitors" \
  -H 'Content-Type: application/json' \
  -d '{"handle":"@nasa","projectId":"'$PID'"}'
```

PowerShell users can call `curl.exe` (forces the real curl, not the `Invoke-WebRequest` alias). When threading JSON values through shell variables on Windows, prefer `ConvertFrom-Json` over `jq`:

```powershell
$resp = curl.exe -s -X POST "$env:BASE/competitors" `
  -H 'Content-Type: application/json' -d '{"handle":"@nasa"}'
$ID = ($resp | ConvertFrom-Json).competitor.id
```

Escape backslashes in JSON paths on Windows (`"C:\\Projects\\foo"`).

## 5. After you act, tell the user what happened

The user can see most of these objects in the app's UI, but they cannot see the HTTP call. After a successful action, briefly state what changed (id + a human-readable label, e.g. handle/title/name). For destructive actions (delete, disarm, reset-home), confirm what's about to go away before you fire the call.

If a capture / workflow run / agent send fails with `warnings`, surface the warnings — they usually contain the user-actionable reason (auth required, rate-limited, missing field).
