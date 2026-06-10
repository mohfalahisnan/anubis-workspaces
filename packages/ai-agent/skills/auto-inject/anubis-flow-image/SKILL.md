---
name: anubis-flow-image
description: Generate images with Google Flow (labs.google) from inside the user's Anubis app by calling the local backend's flow route. It drives a headed Chrome on the isolated `flow` profile — type a prompt, set ratio/variations/model, submit, and get back edit URLs (optionally downloaded image files).
when_to_use: Trigger when the user asks you to *make / generate / render an image* via Google Flow or "Nano Banana" — e.g. "generate a product shot in Flow", "make 4 variations of X", "render this prompt as an image", "buatkan gambar pakai Flow", or any request to produce an image inside the Anubis app (as opposed to discussing one). If they mention a Flow project URL, a ratio, variations, or the Nano Banana / Imagen models, this is the skill.
---

# Anubis Flow Image

Generate images in Google Flow by calling the local Anubis backend. Do not describe — act. Then report the result.

## 0. Prerequisites (headed + login-gated)

- Flow runs in a **visible** Chrome window on the isolated `flow` profile (port 9224). It is **separate from your normal Chrome and starts signed out.**
- The user's Google account must have **Flow + an image model** (`Nano Banana Pro`, `Nano Banana 2`, or `Imagen 4`).
- Generation **costs the user's Flow quota** and takes up to ~2 minutes. Use the smallest `variations` that meets the need; default to 1 unless asked for more.

If generation fails with "Flow Chrome is not reachable", "did not reappear", "no Flow tab", or a login/credits error → the user must open the Flow window and sign in / open a project first (step 2), then retry.

## 1. Find the backend URL

The backend writes its URL to a well-known file at startup — a single line `http://127.0.0.1:<port>`.

**Windows (PowerShell):**
```powershell
$portFile = "$env:LOCALAPPDATA\Anubis\anubis\backend.port"
$env:BASE = if (Test-Path $portFile) { (Get-Content $portFile -Raw).Trim() } else { 'http://127.0.0.1:4317' }
```
**macOS/Linux:**
```bash
portFile="${XDG_DATA_HOME:-$HOME/.local/share}/anubis/backend.port"
BASE=$([ -f "$portFile" ] && cat "$portFile" || echo 'http://127.0.0.1:4317'); export BASE
```
Fallbacks: `$ANUBIS_BACKEND_URL`, `$VITE_API_BASE_URL`, probe `127.0.0.1:4317/health`, ask the user. CORS allows localhost only.

## 2. Make sure the user is signed in with a project open

If this is the first run (or generation reports the tab/login is missing), open the headed Flow window so the user can sign in and open/create a project:

```bash
curl -s -X POST "$BASE/research-crawler/chrome/open" -H 'Content-Type: application/json' \
  -d '{"profile":"flow","headless":false,"url":"https://labs.google/fx/tools/flow"}'
```

Tell the user: "Sign in to Google in the Flow window and open (or create) a project, then I'll generate." Wait for them. Their login persists in the `flow` profile after that.

## 3. Generate

`POST /research-crawler/flow/generate` — body is `.strict()` Zod (unknown keys → 400):

```ts
{
  prompt: string                                  // required
  projectUrl?: string                             // …/tools/flow/project/<id>; opened before generating
  ratio?: '16:9' | '4:3' | '1:1' | '3:4' | '9:16' // default '1:1'
  variations?: 1 | 2 | 3 | 4                       // default 4 — pass 1 to save quota
  model?: string                                   // default 'Nano Banana Pro'
  downloadDir?: string                             // absolute folder; if set, images are saved there
  downloadFilePrefix?: string
  generateTimeoutMs?: number                       // default 120000
  skipReset?: boolean                              // default false; leave it off
  chromeOrigin?: string                            // default http://127.0.0.1:9224
}
```

Prefer passing `projectUrl` so the right project tab is opened. Example:

```bash
curl -s -X POST "$BASE/research-crawler/flow/generate" -H 'Content-Type: application/json' \
  -d '{"prompt":"a single red apple on a plain white background, studio photo","ratio":"1:1","variations":1,"projectUrl":"https://labs.google/fx/id/tools/flow/project/<id>","downloadDir":"C:\\Users\\me\\flow-out"}'
```
Windows: use `curl.exe` and escape backslashes in paths.

## 4. Response

```ts
{
  ok: true
  chromeOrigin, tabUrl, prompt, ratio, variations, model
  resultEditUrls: string[]          // labs.google …/edit/<mediaId> per image
  downloadedImagePaths?: string[]   // present only when downloadDir was set
}
```
- `400` → Zod validation; surface `path` + `message`.
- `500` → generation failed; check `message`. "did not start … tab may not be idle" usually means the Flow window is mid-interaction — retry (it reloads to a clean state first), or have the user click back to the project.

## 5. After acting

Report what you made: the prompt, model/ratio/variations, the `resultEditUrls` (clickable), and any downloaded paths. Confirm before spending quota on large `variations`.

> For a no-code path, the workflow editor has a **Flow Image** node (category Tools): prompt + ratio/variations/model + optional project URL & download dir; prompt falls back to upstream text. A standalone **Flow Images** page exists in the app too.
