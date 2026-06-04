---
name: anubis-core
description: Drive the Anubis backend HTTP API to manage competitors, captures, posts, conversations, AI-agent runs, profiles, skills, config, cron jobs, and Chrome profiles.
when_to_use: User asks to list/add/edit/delete competitors, capture or discover Instagram profiles, open Chrome, manage conversations or messages, run a Claude/Codex agent, import a skill, edit app config, list cron jobs, or inspect local Chrome profiles.
---

# Anubis Core

The Anubis backend is a Hono HTTP server inside the user's running desktop app. This skill explains how to find its URL and which sibling file documents which routes.

## 1. Find the backend URL

In this order:

1. `$ANUBIS_BACKEND_URL` env var, if the user has set one.
2. `$VITE_API_BASE_URL` env var.
3. Probe `http://127.0.0.1:4317/health`; accept if `service === "anubis-backend"`.
4. Scan listening localhost ports — use the right command for the platform:

   **Windows (PowerShell):**
   ```powershell
   Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 |
     Select-Object -Expand LocalPort -Unique | ForEach-Object {
       try {
         $h = Invoke-RestMethod "http://127.0.0.1:$_/health" -TimeoutSec 1
         if ($h.service -eq 'anubis-backend') { "http://127.0.0.1:$_" }
       } catch {}
     } | Select-Object -First 1
   ```

   **macOS (bash/zsh):**
   ```bash
   lsof -nP -iTCP -sTCP:LISTEN | awk '/127\.0\.0\.1:/{print $9}' \
     | sed 's/.*://' | sort -u \
     | while read p; do
         curl -sf --max-time 1 "http://127.0.0.1:$p/health" 2>/dev/null \
           | grep -q anubis-backend && { echo "http://127.0.0.1:$p"; break; }
       done
   ```

   **Linux (bash):**
   ```bash
   ss -tlnH 'sport != 0' | awk '{print $4}' | grep -E '^(127\.0\.0\.1|\*|\[::\]):' \
     | sed 's/.*://' | sort -u \
     | while read p; do
         curl -sf --max-time 1 "http://127.0.0.1:$p/health" 2>/dev/null \
           | grep -q anubis-backend && { echo "http://127.0.0.1:$p"; break; }
       done
   ```
5. Ask the user.

The port is OS-assigned per Electron run and not persisted to disk.

## 2. Read the right sub-file

Each sub-file is materialised next to this SKILL.md (the skill folder is copied wholesale into the agent home).

| Intent | Read |
| --- | --- |
| Chrome/CDP, Instagram capture or discovery | `skills/anubis-core/crawler.md` |
| Competitors, captures, posts | `skills/anubis-core/competitors.md` |
| Conversations, messages, AI agent runs | `skills/anubis-core/conversations.md` |
| Profiles, skills, config, cron-jobs, system | `skills/anubis-core/admin.md` |

Open the sub-file before crafting the request. Don't guess schemas.

## 3. Response envelope

Every route returns one of:

- Success: `{ ok: true, ...payload }` (2xx).
- Validation error: `{ ok: false, error: { code: "BAD_REQUEST", message, issues } }` (400) — Zod issues array.
- Domain error: `{ ok: false, error: { code, message, ... } }` (4xx/5xx).

## 4. Calling the API

All sub-file examples use `curl`, which ships with Windows 10+ (`curl.exe`), macOS, and every modern Linux. Set the URL once per session:

```bash
export BASE=http://127.0.0.1:4317   # bash / zsh
$env:BASE = 'http://127.0.0.1:4317'  # PowerShell
```

Then:

```bash
curl -s "$BASE/competitors"
curl -s -X POST "$BASE/competitors" \
  -H 'Content-Type: application/json' \
  -d '{"handle":"@nasa"}'
```

CORS only allows localhost origins. If the user is not in the app's own UI, run requests against `127.0.0.1` or `localhost`.
