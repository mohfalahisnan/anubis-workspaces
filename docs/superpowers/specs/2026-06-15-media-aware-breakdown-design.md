# Media-aware breakdown step — Design

Date: 2026-06-15
Status: Approved (pending spec review)

## Problem

In Content Studio, the breakdown step turns a reference post's raw idea into an
Improved Brief. Today the AI sees **text only** (caption + transcript). The source
post's actual media — carousel images, single images, video — is never shown to the
model. Image/carousel posts therefore lose all visual information at the breakdown
stage, and the downloaded media is not surfaced in the UI.

We want the breakdown step to:

1. Have all of the reference post's media downloaded locally (all carousel slides,
   the single image, or the video file) plus the transcript for videos.
2. Render those local assets into the breakdown result so the user can see what the
   AI analyzed.
3. Feed the media to the AI appropriately:
   - **image / carousel** → attach the image(s) to the agent (vision).
   - **video** → send the transcript only (no video file to the model).

## Current state (what exists today)

- **Extract step** (`packages/backend/src/content-pipeline/raw-extract.ts`,
  `factory.ts` `extract` dep): builds `RawIdea` from the reference captured post.
  `assetRefs` keeps only the first media URL. For video it downloads to a **temp**
  file solely to transcribe, then discards the file. Images/carousels are never
  downloaded. The transcript is stored on the raw idea.
- **Breakdown step** (`pipeline-service.ts` `runBreakdown`): runs the agent with a
  text-only prompt (caption + transcript via `prompts.ts` `sourceBlock`) → produces
  `ImprovedBrief`.
- **Media URLs** live in the captured post's `raw.media` blob:
  `{ kind: 'image'|'video'|'carousel', urls: string[], videoUrl?: string }`
  (`captured-posts-repo.ts` parses `raw`; `instagram-json-scanner.ts` produces it).
  The `media_url` column keeps only the first URL.
- **Crawler-side download** (`instagram-crawler.ts` `downloadPostAssets`) already
  knows how to fetch every media URL (all carousel slides + video) into a workspace
  cache and records `raw.assetPaths = { absolute[], relative[] }`. **But** the main
  desktop capture path (`captures.ts:304`) does **not** pass `workspacePath`, so
  `assetPaths` is populated only for workflow-captured posts — unreliable in general.
- **Agent file attachment** (`ai-agent-service.ts`):
  - Claude: file paths passed as **positional CLI args** → real attachment with
    vision (`claude/build-args.ts`).
  - Codex / Qoder: only a system-prompt note listing basenames (files assumed to be
    in cwd). Codex's `turn/start` accepts a typed `input[]` array.
  - Antigravity: **no `files` param at all** in its runner.
  - gpt-web / qwen-web: pass `files` through to their own web mechanism. These are in
    `WEB_AGENTS` and are **blocked from running pipeline steps**.
- **Image serving**: `conversation.ts` `GET /conversation/:id/files?path=` is an
  existing, path-traversal-guarded, image-MIME-only static file route to copy.
- The breakdown agent's working dir is
  `<dataDir>/content-pipeline/<itemId>/` (`factory.ts` `runAgent` computes
  `join(dataDir, 'content-pipeline', cwd.split('/').pop())`).

## Decisions (from brainstorming)

1. **Download/persist media at the extract step** (not breakdown). Extract already
   owns media+transcript; assets then survive breakdown re-runs.
2. **Vision via local file paths** handed to the agent (no base64/API plumbing).
3. **Carousel = all slides** (parse `raw.media.urls`).
4. **Add real attach capability to the non-web CLI agents** that lack it; leave the
   web agents (gpt-web/qwen-web) alone (already excluded from the pipeline).

## Design

### 1. Asset acquisition — `assets.ts` (new)

`packages/backend/src/content-pipeline/assets.ts`:

```ts
export interface LocalAsset {
  kind: 'image' | 'video'
  fileName: string   // e.g. "0.jpg", "video.mp4"
  path: string       // absolute path under the item's assets dir
  sourceUrl?: string
}

export interface MaterializeDeps {
  fetchMedia: (url: string) => Promise<Buffer>          // injectable
  transcribe: (videoPath: string) => Promise<string>    // injectable
}

export interface MaterializeInput {
  media?: { kind: 'image'|'video'|'carousel'; urls?: string[]; videoUrl?: string }
  assetPaths?: { absolute: string[]; relative: string[] } // crawler-cached, if present
  destDir: string  // <dataDir>/content-pipeline/<itemId>/assets
}

export interface MaterializeResult {
  assets: LocalAsset[]
  transcript?: string
}

export async function materializePostAssets(
  input: MaterializeInput, deps: MaterializeDeps,
): Promise<MaterializeResult>
```

Behavior:
- Compute the download list from `input.media` using the **same rules** as the
  crawler's `downloadPostAssets`:
  - `image` → `urls[0]` → `0.jpg`
  - `carousel` → `urls[i]` → `i.jpg` (all slides) + optional `videoUrl` → `video.mp4`
  - `video` → `urls[0]` poster → `0.jpg` (if present) + `videoUrl` → `video.mp4`
- **Reuse path:** when `input.assetPaths.absolute` is non-empty and the files exist
  on disk, adopt them as `LocalAsset`s (classify by extension: `.mp4` → video, image
  otherwise) without re-downloading. (We still need filenames/paths for the UI + agent.)
  When reuse covers the media, skip downloading.
- **Download path:** otherwise `mkdir -p destDir`, fetch each URL via `deps.fetchMedia`,
  write to `destDir/<filename>`, skip files that already exist. Per-asset failures are
  collected and logged, never thrown (one bad slide must not kill extract).
- **Transcript:** if a `video.mp4` is present (downloaded or reused), call
  `deps.transcribe(videoPath)`; tolerate failure (caption-only fallback, matching
  today's `df25f576` behavior). Images/carousels: no transcript.

The destination is the item's assets dir so the breakdown agent (cwd =
`<dataDir>/content-pipeline/<itemId>`) can read them. A shared helper
`pipelineItemAssetsDir(dataDir, itemId)` is exported so extract (writer) and the
asset-serving route (reader) agree on the location.

### 2. Wiring at extract — `raw-extract.ts` + `factory.ts`

- `buildRawIdea` input gains the post's `raw.media` and `assetPaths`, plus the
  `destDir`, and delegates media handling to `materializePostAssets`. The old
  inline video-transcription block is removed (folded into the new module).
- `factory.ts` `extract`:
  - resolves the full `CapturedPost` (already does, via `findById` — has `raw` +
    `assetPaths`),
  - computes `destDir = pipelineItemAssetsDir(dataDir, id)`,
  - injects `fetchMedia` (HTTP `fetch` → Buffer) and the existing real transcriber,
  - stores `rawIdea.localAssets`, `rawIdea.transcript`, `transcriptSource` as today.

### 3. Data model — shared `RawIdea`

Extend `RawIdea` (`packages/shared/src/index.ts`):

```ts
export interface RawIdea {
  // …existing…
  localAssets?: LocalAsset[]
}
export interface LocalAsset { kind: 'image'|'video'; fileName: string; path: string; sourceUrl?: string }
```

`LocalAsset` is exported from shared (used by backend + frontend). No DB migration —
`rawIdea` is persisted as a JSON blob in the pipeline row.

### 4. Breakdown — feed media to the agent

`pipeline-service.ts`:
- `PipelineDeps.runAgent` input gains `files?: string[]`.
- `runner(item, step, profileId, settings, onProgress, files?)` forwards `files`
  into `runAgent` (bound in the closure; `runStructured`'s `(prompt) => Promise<string>`
  contract is unchanged).
- `runBreakdown`:
  - reads `rawIdea.localAssets`,
  - if `mediaKind` is `image` or `carousel`: `imageFiles = localAssets.filter(a => a.kind==='image').map(a => a.path)`; pass as `files`; include a `{{media}}` prompt block listing the attached image filenames and instructing the model to analyze them.
  - if `video` (or no images): `files = undefined`; `{{media}}` notes that analysis is
    transcript-based. Transcript already flows through `sourceBlock`.
- `factory.ts` `runAgent` passes `files` into the `agentService` input (`RunAgentInput.files`).

`prompts.ts`:
- Add `{{media}}` placeholder to the default brief template and a `mediaBlock(rawIdea)`
  builder in `buildBriefVars`. Backward-compatible: custom templates without
  `{{media}}` simply don't render it.

### 5. Agent attach capability (#4) — `ai-agent` package

- **Claude** — no change (positional args already give native vision).
- **Codex** (`codex/run.ts`): when `opts.files` includes image files, append
  `{ type: 'localImage', path }` items to the `turn/start` `input[]` array (alongside
  the existing text item). Non-image files keep the system-prompt-note behavior.
- **Antigravity** (`antigravity/runner.ts` + `build-args.ts` + service): add a `files`
  param; surface attached files via the system-prompt note so the agent reads them
  from cwd. (No native image flag on `agy`; relies on its Read tool.)
- **Qoder** — keep the existing note + files-in-cwd mechanism (SDK `query` takes a
  string prompt; no image-input channel). Relies on its Read tool / vision capability.
- **gpt-web / qwen-web** — untouched; excluded from pipeline steps.

Fidelity ceiling (documented, accepted): Claude + Codex get native image vision;
Qoder + Antigravity get "files in workspace + instruction to read them", so whether
they truly *see* an image depends on each agent's Read tool.

### 6. UI — render media into the result

- **Backend route** (`content-pipeline` routes): `GET /content-pipeline/:id/asset?path=`
  mirroring `conversation/:id/files` — resolve against `pipelineItemAssetsDir`,
  reject path traversal (`isPathInside` + realpath check), image MIME only, stream
  the file. (Video files are not served inline for now — image thumbnails only; the
  video presence is shown as a chip.)
- **Frontend** (`sections.tsx` `RawIdeaSection`, and the breakdown step panel in
  `pipeline-timeline.tsx`): render `localAssets`:
  - images → `<img>` thumbnails via the new asset route (using `getApiBaseUrl()`),
  - video → a "Video (transcript analyzed)" chip,
  - transcript stays as a field.
  The breakdown panel shows a compact "Analyzed media" strip so it's clear what the
  AI saw.

### 7. Testing

- `assets.test.ts`: `materializePostAssets` — reuse-from-`assetPaths`, download
  fallback, carousel multi-url (all slides), video → poster+video+transcript,
  per-asset failure tolerance. Pure via injected `fetchMedia`/`transcribe`.
- `pipeline-service` test: `runBreakdown` passes image `files` for image/carousel and
  `undefined` for video; `{{media}}` renders correctly.
- Keep existing content-pipeline + ai-agent tests green.
- Build order: rebuild `@anubis/shared` (new type), `@anubis/ai-agent`,
  `@anubis/backend` before running dependent tests; backend tests with
  `--maxWorkers=2`.

## Out of scope (YAGNI)

- Re-scraping posts that lack media URLs in `raw`.
- Serving/inline-playing video in the UI.
- OCR of images at extract (the *agent* does the visual analysis at breakdown).
- Changing the main capture path to always download assets (extract handles it).
- Native image input for Qoder/Antigravity beyond the read-from-workspace mechanism.

## Packaging note

`materializePostAssets` uses only `node:*` + global `fetch` (no new third-party
dep), so no root-`package.json` change is required.
