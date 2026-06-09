---
name: anubis-core
description: How to act on the user's Anubis content workspace — discover and capture Instagram competitors, manage projects and content drafts, drive workflows and Chrome, run agent conversations, and edit app config — by calling the local Anubis backend HTTP API.
when_to_use: Trigger any time the user asks you to *do something inside their Anubis app* rather than answer a general question. Concrete signals — "add @nasa as a competitor", "capture more posts for X", "list this project's competitors", "create a content draft from this post", "sync metrics on the published post", "run the workflow", "what's in my backlog", "open Chrome for login", "switch to the codex profile", "edit my config", etc. If the user mentions a handle, a project name, a post, a workflow, a content draft, a task, a cron, or any object they can see in the app's UI, you are almost certainly meant to act on it via this skill.
---

# Anubis Core

You run inside the user's Anubis Electron app. Drive its local backend over HTTP. Do not describe — act.

## Data model

- `project` — container. `default` always exists. Most lists take `?projectId=`. Most creates take optional `projectId` (omitted = `default`).
- `competitor` — IG handle. Has `followers`, `avgLikes`, `postCount`, `level` (`black|green|yellow|red`).
- `captured post` — scraped from competitor. Joined with competitor on `/posts`.
- `content item` — user's own draft. Lifecycle: `idea → brief → draft → review → scheduled → published → rejected`. References one captured post or one URL.
- `task` — to-do. `backlog|todo|in_progress|in_review|done`. Optional assignee profile.
- `workflow` — node graph. Has `draft` + `published`. Can be `armed` for schedule/file triggers. Streams SSE.
- `cron job` — recurring prompt. Spawned by agent, not by you. PATCH/DELETE only.
- `conversation` — chat. `manual` or `workflow` source.
- `profile` — agent identity. `claude|codex|antigravity|gpt-web|qwen-web`.
- `Chrome profile` — `login` (9222 headed), `public` (9223 headless), `flow` (9224 headed).
- `Knowledge Base` — per-project searchable corpus, backed by the external `anubis-engine` CLI the user installs and configures in Settings → External binaries. Each project's workspace folder is the corpus; a `.anubisignore` at the workspace root filters indexing. The user manages it directly on the **Knowledge Base** page (index / search / list documents / view ignore file). Backend HTTP routes exist (`POST /knowledge-base/{index,search,context-pack}`, `GET /knowledge-base/{stats,documents,ignore-file}`) but you do not call them yet — tell the user to use the page until tool-call wiring lands.
- `Extractor` — external `anubis-extractor` CLI for OCR (images) and transcription (audio/video). Two workflow nodes drive it: **OCR Extractor** (`ocrExtractor`) for images, **Transcriber** (`transcriber`) for audio/video. Both write `<stem>.anubis.txt` next to the source file; the Knowledge Base picks these up on re-index. Default whisper model is `large-v3` for accuracy (slower; first run downloads ~3 GB). A standalone **Extractor** page lets the user run one-off OCR / transcribe without building a workflow.

## Defaults

- `projectId` — reuse conversation's project. Else omit (= `default`).
- Capture `profile` — `public`. Fall back to `login` only on auth warnings.
- Content item `status` — `idea` for new drafts.
- Workflow runs — use the published graph. If `draftAhead`, tell user before running.

## List before you act

Never invent ids. If user names a thing ("the spacephotography workflow"), list first, match by name.

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

Fallbacks if file missing: `$ANUBIS_BACKEND_URL`, `$VITE_API_BASE_URL`, probe `127.0.0.1:4317/health` for `service=anubis-backend`, ask user.

CORS allows localhost only. Hit `127.0.0.1` or `localhost`.

## 2. Pick the sub-file

| User wants | Read |
| --- | --- |
| competitors, captures, post feed, import posts | `competitors.md` |
| projects, content drafts, sync metrics | `content.md` |
| tasks / to-dos | `tasks.md` |
| workflows, cron jobs | `workflows.md` |
| raw Chrome, raw IG capture, discover handles | `crawler.md` |
| chats, send/stream messages, ai-agent runs | `conversations.md` |
| profiles, skills, config, OS Chrome list | `admin.md` |
| workspaces, directory structure, knowledge base indexing and search | `workspace.md` |

Open the sub-file before calling. Bodies are `.strict()` Zod — unknown keys → 400.

## 3. Responses

- Success: `{ ok: true, ...payload }` (2xx). Workflow routes return bare objects.
- Validation: `400 { ok: false, error: { code: "BAD_REQUEST", message, issues } }`. Surface `path` + `message`, not raw JSON.
- Domain errors you hit most:
  - `409 no_credentials` on conversation send → run `admin.md` → `POST /profiles/:id/login/terminal`, wait for user, retry.
  - `409 agent_not_installed` on profile login → user must install the CLI.

## 4. Calling

```bash
curl -s "$BASE/competitors?projectId=$PID"
curl -s -X POST "$BASE/competitors" -H 'Content-Type: application/json' -d '{"handle":"@nasa"}'
```

SSE: `curl --no-buffer "$BASE/..."`. Windows: `curl.exe`, escape backslashes in JSON paths.

## 5. After acting

Tell the user what changed (id + label: handle/title/name). Confirm destructive actions (delete, disarm, reset-home) before firing. Surface `warnings[]` when present.
