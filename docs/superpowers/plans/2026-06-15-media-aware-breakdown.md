# Media-aware breakdown step Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Download a reference post's media (all carousel slides / image / video+transcript) at the extract step, render it into the breakdown result, and feed images to the breakdown agent (video → transcript only).

**Architecture:** Extract downloads/reuses media into the item's pipeline working dir and records `RawIdea.localAssets`. Breakdown passes image paths to the agent (`files` for native Claude/Codex vision + an `assets/<file>` prompt block any agent can read) and keeps video as transcript-only. A guarded HTTP route serves the images to the renderer for thumbnails.

**Tech Stack:** TypeScript (ESM) monorepo, Hono backend, React 19 frontend, Vitest. AI runs via `@anubis/ai-agent` CLI/SDK agents.

---

## Background the implementer needs

- **Build order matters** (vitest resolves `@anubis/*` to `dist`): after changing a package, rebuild it before running tests that depend on it. Order: `@anubis/shared` → `@anubis/ai-agent` → `@anubis/backend` → `@anubis/frontend`. Commands:
  - `pnpm --filter @anubis/shared build`
  - `pnpm --filter @anubis/ai-agent build`
  - `pnpm --filter @anubis/backend build`
- **Backend tests flake under load** — always run with `--maxWorkers=2`.
- **Run a single backend test file:** `pnpm vitest run packages/backend/tests/content-pipeline/<file>.test.ts --maxWorkers=2` (from repo root).
- **Frontend tests:** `cd packages/frontend && pnpm vitest run`.
- **Typecheck everything:** `pnpm typecheck` (from root).
- The branch `feat/media-aware-breakdown` already exists and is checked out (the spec is committed there).

Key existing facts (already verified):
- Media URLs live in the captured post's `raw.media` = `{ kind: 'image'|'video'|'carousel', urls?: string[], videoUrl?: string }`. `stack.capturedPosts.findById(id)` returns a `CapturedPost` with `raw` (parsed) and `assetPaths?: { absolute: string[]; relative: string[] }`.
- The breakdown agent's cwd is `<dataDir>/content-pipeline/<itemId>` (`factory.ts` `runAgent`: `join(dataDir, 'content-pipeline', cwd.split('/').pop())`).
- `RunAgentInput` (in `packages/ai-agent/src/service/ai-agent-service.ts`) already has `files?: string[]`. Claude attaches them as positional CLI args (vision). Codex/Qoder/Antigravity get a system-prompt note listing basenames.
- `transcript` failure must be tolerated (caption-only fallback) — existing behavior from commit `df25f576`.
- Existing image-serving precedent: `conversation.ts` `GET /conversations/:id/files?path=` with `isPathInside` + realpath guards + `IMAGE_MIME`.
- `content-items.ts` routes are mounted at `/content-items` (`app.ts:73`).

---

## Task 1: Shared `LocalAsset` type + `RawIdea.localAssets`

**Files:**
- Modify: `packages/shared/src/index.ts` (near `interface RawIdea`, ~line 980)

- [ ] **Step 1: Add the `LocalAsset` type and extend `RawIdea`**

In `packages/shared/src/index.ts`, immediately **above** `export interface RawIdea {`:

```ts
/** A reference-post media file downloaded to the item's pipeline working dir. */
export interface LocalAsset {
  kind: 'image' | 'video'
  /** Basename within the item's assets dir, e.g. "0.jpg", "video.mp4". */
  fileName: string
  /** Absolute path on the backend host. */
  path: string
  /** Original media URL it was downloaded from (absent when reused from cache). */
  sourceUrl?: string
}
```

Then add one field inside `RawIdea` (after `transcript?: string`):

```ts
  /** Media downloaded at extract: all carousel slides / the image / the video. */
  localAssets?: LocalAsset[]
```

- [ ] **Step 2: Build shared and typecheck it**

Run: `pnpm --filter @anubis/shared build`
Expected: builds with no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): LocalAsset type + RawIdea.localAssets"
```

---

## Task 2: `assets.ts` — `materializePostAssets` + `pipelineItemAssetsDir`

**Files:**
- Create: `packages/backend/src/content-pipeline/assets.ts`
- Create: `packages/backend/tests/content-pipeline/assets.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/tests/content-pipeline/assets.test.ts`:

```ts
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { materializePostAssets, pipelineItemAssetsDir } from '../../src/content-pipeline/assets.js'

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'anubis-assets-'))
}

describe('pipelineItemAssetsDir', () => {
  it('joins data dir / content-pipeline / id / assets', () => {
    expect(pipelineItemAssetsDir('/data', 'c1').replace(/\\/g, '/')).toBe('/data/content-pipeline/c1/assets')
  })
})

describe('materializePostAssets', () => {
  it('downloads all carousel slides as images', async () => {
    const destDir = join(tmp(), 'assets')
    const fetchMedia = vi.fn(async (url: string) => Buffer.from(`bytes:${url}`))
    const transcribe = vi.fn()
    const res = await materializePostAssets(
      { media: { kind: 'carousel', urls: ['https://cdn/a.jpg', 'https://cdn/b.jpg'] }, destDir },
      { fetchMedia, transcribe },
    )
    expect(res.assets.map((a) => a.fileName)).toEqual(['0.jpg', '1.jpg'])
    expect(res.assets.every((a) => a.kind === 'image')).toBe(true)
    expect(res.transcript).toBeUndefined()
    expect(existsSync(join(destDir, '0.jpg'))).toBe(true)
    expect(fetchMedia).toHaveBeenCalledTimes(2)
  })

  it('downloads the video file and transcribes it', async () => {
    const destDir = join(tmp(), 'assets')
    const fetchMedia = vi.fn(async () => Buffer.from('vid'))
    const transcribe = vi.fn(async () => 'spoken words')
    const res = await materializePostAssets(
      { media: { kind: 'video', urls: ['https://cdn/poster.jpg'], videoUrl: 'https://cdn/v.mp4' }, destDir },
      { fetchMedia, transcribe },
    )
    expect(res.assets.map((a) => a.fileName)).toEqual(['0.jpg', 'video.mp4'])
    expect(res.assets.find((a) => a.fileName === 'video.mp4')!.kind).toBe('video')
    expect(transcribe).toHaveBeenCalledWith(join(destDir, 'video.mp4'))
    expect(res.transcript).toBe('spoken words')
  })

  it('tolerates a transcription failure (caption-only fallback)', async () => {
    const destDir = join(tmp(), 'assets')
    const fetchMedia = vi.fn(async () => Buffer.from('vid'))
    const transcribe = vi.fn(async () => { throw new Error('no audio stream') })
    const res = await materializePostAssets(
      { media: { kind: 'video', videoUrl: 'https://cdn/silent.mp4' }, destDir },
      { fetchMedia, transcribe },
    )
    expect(res.transcript).toBeUndefined()
    expect(res.assets.map((a) => a.fileName)).toEqual(['video.mp4'])
  })

  it('reuses already-downloaded assetPaths without fetching', async () => {
    const cache = tmp()
    const a0 = join(cache, '0.jpg')
    const v = join(cache, 'video.mp4')
    writeFileSync(a0, 'x'); writeFileSync(v, 'y')
    const fetchMedia = vi.fn()
    const transcribe = vi.fn(async () => 'words')
    const res = await materializePostAssets(
      {
        media: { kind: 'carousel', urls: ['https://cdn/a.jpg'], videoUrl: 'https://cdn/v.mp4' },
        assetPaths: { absolute: [a0, v], relative: [] },
        destDir: join(tmp(), 'assets'),
      },
      { fetchMedia, transcribe },
    )
    expect(fetchMedia).not.toHaveBeenCalled()
    expect(res.assets.map((a) => `${a.kind}:${a.fileName}`)).toEqual(['image:0.jpg', 'video:video.mp4'])
    expect(res.transcript).toBe('words')
  })

  it('continues past a single failed download', async () => {
    const destDir = join(tmp(), 'assets')
    const fetchMedia = vi.fn(async (url: string) => {
      if (url.includes('bad')) throw new Error('HTTP 403')
      return Buffer.from('ok')
    })
    const res = await materializePostAssets(
      { media: { kind: 'carousel', urls: ['https://cdn/bad.jpg', 'https://cdn/good.jpg'] }, destDir },
      { fetchMedia, transcribe: vi.fn() },
    )
    expect(res.assets.map((a) => a.fileName)).toEqual(['1.jpg'])
  })

  it('returns nothing when there is no media', async () => {
    const res = await materializePostAssets({ destDir: join(tmp(), 'assets') }, { fetchMedia: vi.fn(), transcribe: vi.fn() })
    expect(res.assets).toEqual([])
    expect(res.transcript).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/backend/tests/content-pipeline/assets.test.ts --maxWorkers=2`
Expected: FAIL — cannot find module `../../src/content-pipeline/assets.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/backend/src/content-pipeline/assets.ts`:

```ts
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { LocalAsset } from '@anubis/shared'

/** The on-disk dir where an item's reference media is materialized. */
export function pipelineItemAssetsDir(dataDir: string, itemId: string): string {
  return join(dataDir, 'content-pipeline', itemId, 'assets')
}

export interface PostMedia {
  kind: 'image' | 'video' | 'carousel'
  urls?: string[]
  videoUrl?: string
}

export interface MaterializeDeps {
  /** Fetch a media URL into a buffer. Injected so tests stay pure. */
  fetchMedia: (url: string) => Promise<Buffer>
  /** Transcribe a local video file. Injected so tests stay pure. */
  transcribe: (videoPath: string) => Promise<string>
}

export interface MaterializeInput {
  media?: PostMedia
  /** Crawler-cached absolute paths, when capture already downloaded the media. */
  assetPaths?: { absolute: string[]; relative: string[] }
  destDir: string
}

export interface MaterializeResult {
  assets: LocalAsset[]
  transcript?: string
}

interface Planned {
  url: string
  fileName: string
  kind: LocalAsset['kind']
}

/** The download plan for a post's media — mirrors the crawler's downloadPostAssets. */
function planDownloads(media: PostMedia): Planned[] {
  const out: Planned[] = []
  if (media.kind === 'video') {
    if (media.urls?.[0]) out.push({ url: media.urls[0], fileName: '0.jpg', kind: 'image' })
    if (media.videoUrl) out.push({ url: media.videoUrl, fileName: 'video.mp4', kind: 'video' })
  } else if (media.kind === 'carousel') {
    media.urls?.forEach((url, i) => out.push({ url, fileName: `${i}.jpg`, kind: 'image' }))
    if (media.videoUrl) out.push({ url: media.videoUrl, fileName: 'video.mp4', kind: 'video' })
  } else if (media.kind === 'image') {
    if (media.urls?.[0]) out.push({ url: media.urls[0], fileName: '0.jpg', kind: 'image' })
  }
  return out
}

function classify(fileName: string): LocalAsset['kind'] {
  return extname(fileName).toLowerCase() === '.mp4' ? 'video' : 'image'
}

/**
 * Materialize a reference post's media into `destDir`, reusing crawler-cached
 * files when present. Returns the local assets and (for video) a transcript.
 * Per-asset failures are logged, never thrown — one bad slide or a silent
 * video must not kill the extract step.
 */
export async function materializePostAssets(
  input: MaterializeInput,
  deps: MaterializeDeps,
): Promise<MaterializeResult> {
  // Reuse path: capture already downloaded everything.
  const cached = input.assetPaths?.absolute?.filter((p) => existsSync(p)) ?? []
  if (cached.length > 0) {
    const assets: LocalAsset[] = cached.map((p) => ({ kind: classify(p), fileName: basename(p), path: p }))
    const video = assets.find((a) => a.kind === 'video')
    const transcript = video ? await safeTranscribe(deps, video.path) : undefined
    return { assets, transcript }
  }

  if (!input.media) return { assets: [] }

  mkdirSync(input.destDir, { recursive: true })
  const assets: LocalAsset[] = []
  for (const item of planDownloads(input.media)) {
    const target = join(input.destDir, item.fileName)
    try {
      if (!existsSync(target)) {
        const buf = await deps.fetchMedia(item.url)
        writeFileSync(target, buf)
      }
      assets.push({ kind: item.kind, fileName: item.fileName, path: target, sourceUrl: item.url })
    } catch (err) {
      console.warn(
        `[content-pipeline] failed to download ${item.url}: `
        + (err instanceof Error ? err.message : String(err)),
      )
    }
  }

  const video = assets.find((a) => a.kind === 'video')
  const transcript = video ? await safeTranscribe(deps, video.path) : undefined
  return { assets, transcript }
}

async function safeTranscribe(deps: MaterializeDeps, videoPath: string): Promise<string | undefined> {
  try {
    return await deps.transcribe(videoPath)
  } catch (err) {
    console.warn(
      `[content-pipeline] transcription failed for ${videoPath}; continuing without a transcript: `
      + (err instanceof Error ? err.message : String(err)),
    )
    return undefined
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/backend/tests/content-pipeline/assets.test.ts --maxWorkers=2`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/content-pipeline/assets.ts packages/backend/tests/content-pipeline/assets.test.ts
git commit -m "feat(content-pipeline): materializePostAssets — download/reuse reference media"
```

---

## Task 3: Rewrite `buildRawIdea` to use `materializePostAssets`

**Files:**
- Modify: `packages/backend/src/content-pipeline/raw-extract.ts`
- Modify: `packages/backend/tests/content-pipeline/raw-extract.test.ts`

The current `buildRawIdea` transcribes inline. We move media handling into `materializePostAssets`, and `buildRawIdea` becomes a thin assembler that also accepts the post's `media` + `assetPaths` and a `destDir`.

- [ ] **Step 1: Update the test to the new contract**

Replace the entire body of `packages/backend/tests/content-pipeline/raw-extract.test.ts` with:

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { CapturedPostSummary } from '@anubis/shared'
import { buildRawIdea } from '../../src/content-pipeline/raw-extract.js'

const destDir = () => join(mkdtempSync(join(tmpdir(), 'anubis-raw-')), 'assets')

const imgPost = {
  id: 'p1', competitorId: 'k1', username: 'acme', postUrl: 'https://ig/p/1',
  caption: 'hello', mediaKind: 'image', mediaUrl: 'https://cdn/x.jpg', capturedAt: 1,
  competitorHandle: '@acme',
} as CapturedPostSummary

describe('buildRawIdea', () => {
  it('assembles fields and downloads an image without transcribing', async () => {
    const fetchMedia = vi.fn(async () => Buffer.from('img'))
    const transcribe = vi.fn()
    const raw = await buildRawIdea({
      post: imgPost,
      media: { kind: 'image', urls: ['https://cdn/x.jpg'] },
      destDir: destDir(),
      fetchMedia,
      transcribeMedia: transcribe,
    })
    expect(raw.caption).toBe('hello')
    expect(raw.sourceUrl).toBe('https://ig/p/1')
    expect(raw.mediaKind).toBe('image')
    expect(raw.transcript).toBeUndefined()
    expect(raw.localAssets!.map((a) => a.fileName)).toEqual(['0.jpg'])
    expect(transcribe).not.toHaveBeenCalled()
  })

  it('downloads + transcribes a video post', async () => {
    const fetchMedia = vi.fn(async () => Buffer.from('v'))
    const transcribe = vi.fn(async () => 'spoken words')
    const raw = await buildRawIdea({
      post: { ...imgPost, mediaKind: 'video' },
      media: { kind: 'video', videoUrl: 'https://cdn/v.mp4' },
      destDir: destDir(),
      fetchMedia,
      transcribeMedia: transcribe,
    })
    expect(transcribe).toHaveBeenCalled()
    expect(raw.transcript).toBe('spoken words')
    expect(raw.localAssets!.map((a) => a.kind)).toContain('video')
  })

  it('survives a transcription failure with caption only', async () => {
    const fetchMedia = vi.fn(async () => Buffer.from('v'))
    const transcribe = vi.fn(async () => { throw new Error('no stream') })
    const raw = await buildRawIdea({
      post: { ...imgPost, mediaKind: 'video' },
      media: { kind: 'video', videoUrl: 'https://cdn/silent.mp4' },
      destDir: destDir(),
      fetchMedia,
      transcribeMedia: transcribe,
    })
    expect(raw.transcript).toBeUndefined()
    expect(raw.caption).toBe('hello')
  })

  it('falls back to referenceUrl when there is no post', async () => {
    const raw = await buildRawIdea({
      referenceUrl: 'https://ig/p/9',
      destDir: destDir(),
      fetchMedia: vi.fn(),
      transcribeMedia: vi.fn(),
    })
    expect(raw.sourceUrl).toBe('https://ig/p/9')
    expect(raw.assetRefs).toEqual([])
    expect(raw.localAssets ?? []).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/backend/tests/content-pipeline/raw-extract.test.ts --maxWorkers=2`
Expected: FAIL — `buildRawIdea` doesn't accept `media`/`destDir`/`fetchMedia`.

- [ ] **Step 3: Rewrite `raw-extract.ts`**

Replace the entire contents of `packages/backend/src/content-pipeline/raw-extract.ts` with:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CapturedPostSummary, RawIdea } from '@anubis/shared'
import { runTranscribe } from '../extractor.js'
import { materializePostAssets, type PostMedia } from './assets.js'

/** Transcribe a local video file. Injected so tests stay pure. */
export type TranscribeMedia = (videoPath: string) => Promise<string>
/** Fetch a media URL into a buffer. Injected so tests stay pure. */
export type FetchMedia = (url: string) => Promise<Buffer>

export interface BuildRawIdeaInput {
  post?: CapturedPostSummary
  referenceUrl?: string
  /** Media descriptor from the captured post's `raw.media`, if available. */
  media?: PostMedia
  /** Crawler-cached absolute paths from the post's `raw.assetPaths`, if present. */
  assetPaths?: { absolute: string[]; relative: string[] }
  /** Where to materialize downloaded media (the item's pipeline assets dir). */
  destDir: string
  fetchMedia: FetchMedia
  transcribeMedia: TranscribeMedia
}

export async function buildRawIdea(input: BuildRawIdeaInput): Promise<RawIdea> {
  const { post, referenceUrl } = input
  const assetRefs = post?.mediaUrl ? [post.mediaUrl] : []
  const raw: RawIdea = {
    caption: post?.caption,
    assetRefs,
    sourceUrl: post?.postUrl ?? referenceUrl,
    sourcePlatform: post ? 'instagram' : undefined,
    sourceCompetitor: post?.competitorHandle ?? post?.username,
    mediaKind: post?.mediaKind,
    mediaMetadata: post
      ? { likes: post.likes, comments: post.comments, postedAt: post.postedAt, carouselCount: post.carouselCount }
      : undefined,
  }

  const { assets, transcript } = await materializePostAssets(
    { media: input.media, assetPaths: input.assetPaths, destDir: input.destDir },
    { fetchMedia: input.fetchMedia, transcribe: input.transcribeMedia },
  )
  if (assets.length) raw.localAssets = assets
  if (transcript) raw.transcript = transcript

  return raw
}

/** Real transcriber: run whisper via the extractor CLI on an already-local file. */
export function makeRealTranscriber(): TranscribeMedia {
  return async (videoPath: string) => {
    const result = await runTranscribe(videoPath)
    return result.text
  }
}

/** Real media fetcher: download a URL into a buffer. */
export function makeRealFetchMedia(): FetchMedia {
  return async (url: string) => {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed to download media (${res.status})`)
    return Buffer.from(await res.arrayBuffer())
  }
}

/**
 * Legacy helper retained for callers that still transcribe a remote URL directly
 * (downloads to a temp file first). New code uses makeRealFetchMedia +
 * makeRealTranscriber via materializePostAssets.
 */
export function makeUrlTranscriber(): (mediaUrl: string) => Promise<string> {
  return async (mediaUrl: string) => {
    const res = await fetch(mediaUrl)
    if (!res.ok) throw new Error(`Failed to download media (${res.status})`)
    const buf = Buffer.from(await res.arrayBuffer())
    const dir = mkdtempSync(join(tmpdir(), 'anubis-media-'))
    const file = join(dir, 'media.mp4')
    writeFileSync(file, buf)
    const result = await runTranscribe(file)
    return result.text
  }
}
```

> Note: `makeUrlTranscriber` keeps the old temp-download behavior only as a fallback; the new extract path (Task 4) uses `makeRealFetchMedia` + `makeRealTranscriber`. If `pnpm typecheck` later flags `makeUrlTranscriber` as unused, delete it — no other code references the old `makeRealTranscriber(url)` signature after Task 4.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/backend/tests/content-pipeline/raw-extract.test.ts --maxWorkers=2`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/content-pipeline/raw-extract.ts packages/backend/tests/content-pipeline/raw-extract.test.ts
git commit -m "feat(content-pipeline): buildRawIdea downloads media + records localAssets"
```

---

## Task 4: Wire the extract dep in `factory.ts`

**Files:**
- Modify: `packages/backend/src/content-pipeline/factory.ts` (imports; `extract` dep ~lines 198-217; `getTranscriber` ~224)

- [ ] **Step 1: Update imports**

In `factory.ts`, change the `raw-extract` import line:

```ts
import { buildRawIdea, makeRealTranscriber, makeRealFetchMedia, type TranscribeMedia, type FetchMedia } from './raw-extract.js'
import { pipelineItemAssetsDir, type PostMedia } from './assets.js'
```

- [ ] **Step 2: Replace the `extract` dep implementation**

Replace the `extract:` property (currently lines ~198-217) with:

```ts
    extract: async (id) => {
      const item = stack.contentItems.findById(id)
      if (!item) throw new Error(`content item ${id} not found`)
      const post = item.referencePostId ? stack.capturedPosts.findById(item.referencePostId) ?? undefined : undefined
      const destDir = pipelineItemAssetsDir(dataDir, id)
      const raw = await buildRawIdea({
        post: post as never,
        referenceUrl: item.referenceUrl,
        media: (post?.raw?.media as PostMedia | undefined),
        assetPaths: post?.assetPaths,
        destDir,
        fetchMedia: getFetchMedia(),
        transcribeMedia: getTranscriber(),
      })
      stack.contentPipeline.patch(id, {
        rawIdea: raw,
        transcript: raw.transcript,
        transcriptSource: raw.transcript ? 'extractor' : undefined,
      })
      stack.contentPipelineHistory.append({
        contentId: id,
        iteration: stack.contentPipeline.get(id).autoIterationCount,
        step: 'extract',
        data: raw,
      })
      stack.contentItems.update(id, { status: 'raw_extracted' })
      return raw
    },
```

> `post as never` mirrors the existing loose typing — `findById` returns the repo's `CapturedPost` (a superset of `CapturedPostSummary`). `post.raw` is the parsed JSON blob; `post.raw.media` is the `{ kind, urls, videoUrl }` descriptor the scanner stored.

- [ ] **Step 3: Add a `getFetchMedia` export next to `getTranscriber`**

At the bottom of `factory.ts`, alongside `getTranscriber`:

```ts
export function getTranscriber(): TranscribeMedia {
  return makeRealTranscriber()
}

export function getFetchMedia(): FetchMedia {
  return makeRealFetchMedia()
}
```

- [ ] **Step 4: Typecheck the backend**

Run: `pnpm --filter @anubis/backend build`
Expected: builds with no errors. (If `post.raw` typing complains, confirm `CapturedPost.raw?: Record<string, unknown>` — cast via `(post?.raw as Record<string, unknown> | undefined)?.media as PostMedia | undefined`.)

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/content-pipeline/factory.ts
git commit -m "feat(content-pipeline): extract downloads reference media into the item assets dir"
```

---

## Task 5: `{{media}}` prompt placeholder

**Files:**
- Modify: `packages/backend/src/content-pipeline/prompts.ts`
- Modify: `packages/backend/tests/content-pipeline/prompts.test.ts`

- [ ] **Step 1: Add a failing test**

Append to `packages/backend/tests/content-pipeline/prompts.test.ts` (inside the existing top-level `describe` or as a new one — match the file's existing import of `buildBriefVars`/`renderPrompt`; if they aren't imported yet, add `import { buildBriefVars } from '../../src/content-pipeline/prompts.js'`):

```ts
describe('buildBriefVars media block', () => {
  it('lists attached image paths for an image/carousel post', () => {
    const vars = buildBriefVars({
      rawIdea: { caption: 'c', assetRefs: [], mediaKind: 'carousel', localAssets: [
        { kind: 'image', fileName: '0.jpg', path: '/x/assets/0.jpg' },
        { kind: 'image', fileName: '1.jpg', path: '/x/assets/1.jpg' },
      ] },
      context: '',
      lessons: [],
    })
    expect(vars.media).toContain('assets/0.jpg')
    expect(vars.media).toContain('assets/1.jpg')
    expect(vars.media.toLowerCase()).toContain('image')
  })

  it('notes transcript-only analysis for a video post', () => {
    const vars = buildBriefVars({
      rawIdea: { caption: 'c', assetRefs: [], mediaKind: 'video', transcript: 'spoken', localAssets: [
        { kind: 'video', fileName: 'video.mp4', path: '/x/assets/video.mp4' },
      ] },
      context: '',
      lessons: [],
    })
    expect(vars.media.toLowerCase()).toContain('transcript')
    expect(vars.media).not.toContain('assets/video.mp4')
  })

  it('is empty when there are no local assets', () => {
    const vars = buildBriefVars({ rawIdea: { caption: 'c', assetRefs: [] }, context: '', lessons: [] })
    expect(vars.media).toBe('')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/backend/tests/content-pipeline/prompts.test.ts --maxWorkers=2`
Expected: FAIL — `vars.media` is undefined.

- [ ] **Step 3: Implement `mediaBlock` + wire `{{media}}`**

In `prompts.ts`, add a builder (after `sourceBlock`):

```ts
function mediaBlock(rawIdea: RawIdea): string {
  const assets = rawIdea.localAssets ?? []
  if (!assets.length) return ''
  const images = assets.filter((a) => a.kind === 'image')
  const hasVideo = assets.some((a) => a.kind === 'video')
  // Video → analyze via transcript only (do not attach the file to the model).
  if (rawIdea.mediaKind === 'video' || (hasVideo && !images.length)) {
    return 'This is a VIDEO post. Analyze it from the transcript above only; no frames are attached.'
  }
  if (!images.length) return ''
  const list = images.map((a) => `- assets/${a.fileName}`).join('\n')
  return [
    `This is ${rawIdea.mediaKind === 'carousel' ? 'a CAROUSEL' : 'an IMAGE'} post. The following image file(s) are attached and also present in your working directory — open/read them and factor the visuals into the brief:`,
    list,
  ].join('\n')
}
```

Update `buildBriefVars` to return `media`:

```ts
export function buildBriefVars(input: {
  rawIdea: RawIdea
  context: string
  lessons: Array<Pick<ContentLesson, 'type' | 'howToImprove'>>
}): Record<string, string> {
  return {
    source: sourceBlock(input.rawIdea),
    media: mediaBlock(input.rawIdea),
    context: contextBlock(input.context),
    lessons: lessonsBlock(input.lessons),
  }
}
```

Add the `{{media}}` token to the default brief template (in `DEFAULT_PROMPT_TEMPLATES.brief`), right after the `{{source}}` block:

```ts
    '=== SOURCE (raw idea) ===',
    '{{source}}',
    '',
    '=== REFERENCE MEDIA ===',
    '{{media}}',
    '',
    '=== BRAND & KNOWLEDGE CONTEXT ===',
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/backend/tests/content-pipeline/prompts.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/content-pipeline/prompts.ts packages/backend/tests/content-pipeline/prompts.test.ts
git commit -m "feat(content-pipeline): {{media}} brief placeholder (images vs transcript-only)"
```

---

## Task 6: `runBreakdown` passes image files; plumb `files` through `runAgent`

**Files:**
- Modify: `packages/backend/src/content-pipeline/pipeline-service.ts` (`PipelineDeps.runAgent` ~line 53; `runner` ~87; `runBreakdown` ~167)
- Modify: `packages/backend/tests/content-pipeline/pipeline-service.test.ts`

- [ ] **Step 1: Add a failing test**

In `pipeline-service.test.ts`, add to the `describe('ContentPipelineService.runBreakdown', …)` block:

```ts
  it('attaches image files for an image/carousel post', async () => {
    const { deps } = makeDeps()
    deps.pipeline.get.mockReturnValue({
      contentId: 'c1', autoIterationCount: 0,
      rawIdea: { caption: 'cap', assetRefs: [], mediaKind: 'carousel', localAssets: [
        { kind: 'image', fileName: '0.jpg', path: '/d/content-pipeline/c1/assets/0.jpg' },
        { kind: 'image', fileName: '1.jpg', path: '/d/content-pipeline/c1/assets/1.jpg' },
      ] },
    })
    deps.runAgent.mockResolvedValue(JSON.stringify(briefFixture()))
    const svc = new ContentPipelineService(deps as never)
    await svc.runBreakdown('c1')
    const call = deps.runAgent.mock.calls[0]![0] as { files?: string[] }
    expect(call.files).toEqual([
      '/d/content-pipeline/c1/assets/0.jpg',
      '/d/content-pipeline/c1/assets/1.jpg',
    ])
  })

  it('does NOT attach files for a video post', async () => {
    const { deps } = makeDeps()
    deps.pipeline.get.mockReturnValue({
      contentId: 'c1', autoIterationCount: 0,
      rawIdea: { caption: 'cap', assetRefs: [], mediaKind: 'video', transcript: 'spoken', localAssets: [
        { kind: 'video', fileName: 'video.mp4', path: '/d/content-pipeline/c1/assets/video.mp4' },
      ] },
    })
    deps.runAgent.mockResolvedValue(JSON.stringify(briefFixture()))
    const svc = new ContentPipelineService(deps as never)
    await svc.runBreakdown('c1')
    const call = deps.runAgent.mock.calls[0]![0] as { files?: string[] }
    expect(call.files ?? []).toEqual([])
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run packages/backend/tests/content-pipeline/pipeline-service.test.ts --maxWorkers=2`
Expected: FAIL — `call.files` is undefined for the carousel case.

- [ ] **Step 3: Add `files` to the `runAgent` dep type**

In `pipeline-service.ts`, inside `PipelineDeps.runAgent`'s input object type, add after `temperature?: number`:

```ts
    /** Absolute paths attached to the agent turn (e.g. reference images). */
    files?: string[]
```

- [ ] **Step 4: Thread `files` through `runner`**

Change the `runner` signature + body:

```ts
  private runner(
    item: PipelineItem,
    step: string,
    profileId: string | undefined,
    settings: PipelineStepSettings | undefined,
    onProgress?: (message: string) => void,
    files?: string[],
  ): StructuredRunner {
    return (prompt: string) => this.deps.runAgent({
      prompt,
      cwd: `content-pipeline/${item.id}`,
      projectId: item.projectId,
      step,
      profileId,
      model: settings?.model,
      reasoningEffort: settings?.reasoningEffort,
      temperature: settings?.temperature,
      files,
      onProgress,
    })
  }
```

- [ ] **Step 5: Compute image files in `runBreakdown`**

In `runBreakdown`, after `const rawIdea = (p.rawIdea ?? { assetRefs: [] }) as RawIdea`, add:

```ts
    // image / carousel → attach the downloaded images for the agent to view.
    // video → transcript-only (no files); see {{media}} block.
    const imageFiles = (rawIdea.mediaKind === 'image' || rawIdea.mediaKind === 'carousel')
      ? (rawIdea.localAssets ?? []).filter((a) => a.kind === 'image').map((a) => a.path)
      : []
```

Then pass `imageFiles` into the runner call inside `runBreakdown`:

```ts
    const brief = await this.runAiStep(id, 'breakdown', resolvedId, (onProgress) => runStructured(this.runner(item, 'brief', resolvedId, settings, onProgress, imageFiles), {
      prompt: buildBriefPrompt({ rawIdea, context, lessons }, settings?.promptTemplate),
      schema: ImprovedBriefSchema,
      maxAttempts: settings?.maxJsonAttempts,
    }))
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm vitest run packages/backend/tests/content-pipeline/pipeline-service.test.ts --maxWorkers=2`
Expected: PASS (including the two new cases and all prior).

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/content-pipeline/pipeline-service.ts packages/backend/tests/content-pipeline/pipeline-service.test.ts
git commit -m "feat(content-pipeline): breakdown attaches image files (video stays transcript-only)"
```

---

## Task 7: Forward `files` from the pipeline `runAgent` into the agent service

**Files:**
- Modify: `packages/backend/src/content-pipeline/factory.ts` (`runAgent` dep destructure ~line 108; `input` object ~136)

- [ ] **Step 1: Destructure `files`**

In `factory.ts`, the `runAgent` dep signature currently destructures `{ prompt, cwd, projectId, step, profileId, model: stepModel, reasoningEffort: stepEffort, temperature, onProgress }`. Add `files`:

```ts
    runAgent: async ({ prompt, cwd, projectId, step, profileId, model: stepModel, reasoningEffort: stepEffort, temperature, files, onProgress }) => {
```

- [ ] **Step 2: Pass `files` into the agent `input`**

In the `const input = { … }` object (the one with `agent, cwd: workDir, prompt, model, …`), add:

```ts
        files,
```

(place it near `prompt` / `model`).

- [ ] **Step 3: Build the backend**

Run: `pnpm --filter @anubis/backend build`
Expected: builds clean.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/content-pipeline/factory.ts
git commit -m "feat(content-pipeline): forward attached files into the agent run"
```

---

## Task 8: Codex native image input (`localImage`)

Claude already attaches images as positional CLI args; Codex/Qoder/Antigravity get a system-prompt note (the files sit in cwd and the `{{media}}` block points to `assets/<file>`). This task adds **native** image vision for Codex by appending `localImage` input items to its `turn/start`.

**Files:**
- Modify: `packages/ai-agent/src/agents/codex/run.ts` (`CodexRunOpts` type; `turn/start` input ~line 274)
- Modify: `packages/ai-agent/src/service/ai-agent-service.ts` (codex branch ~line 204 — pass `files`)
- Create: `packages/ai-agent/tests/codex-input.test.ts`

- [ ] **Step 1: Find the `CodexRunOpts` type and add `files`**

In `codex/run.ts`, locate `interface CodexRunOpts` (near the top). Add:

```ts
  files?: string[]
```

- [ ] **Step 2: Extract a pure helper for building the input array + write its test**

In `codex/run.ts`, add an exported pure function near the top (after imports):

```ts
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])

/** Build the codex `turn/start` input items: the text prompt plus any local images. */
export function buildCodexTurnInput(text: string, files?: string[]): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [{ type: 'text', text }]
  for (const f of files ?? []) {
    const dot = f.lastIndexOf('.')
    const ext = dot === -1 ? '' : f.slice(dot).toLowerCase()
    if (IMAGE_EXTS.has(ext)) items.push({ type: 'localImage', path: f })
  }
  return items
}
```

Create `packages/ai-agent/tests/codex-input.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildCodexTurnInput } from '../src/agents/codex/run.js'

describe('buildCodexTurnInput', () => {
  it('returns just the text item with no files', () => {
    expect(buildCodexTurnInput('hi')).toEqual([{ type: 'text', text: 'hi' }])
  })

  it('appends a localImage item per image file', () => {
    const out = buildCodexTurnInput('hi', ['/a/0.jpg', '/a/notes.txt', '/a/1.PNG'])
    expect(out).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'localImage', path: '/a/0.jpg' },
      { type: 'localImage', path: '/a/1.PNG' },
    ])
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm vitest run packages/ai-agent/tests/codex-input.test.ts`
Expected: FAIL — `buildCodexTurnInput` not exported / module path. (If `@anubis/ai-agent` has no `tests/` dir yet, confirm its `vitest`/`package.json` test glob includes `tests/**`; the package builds to `dist` but vitest runs against `src`. If the package has no test runner configured, instead place this test at `packages/ai-agent/src/agents/codex/__tests__/codex-input.test.ts` to match an existing test location — check `ls packages/ai-agent` first and follow the established pattern.)

- [ ] **Step 4: Use the helper in `turn/start`**

In `codex/run.ts`, replace the `turn/start` input array:

```ts
        client.request('turn/start', {
          threadId,
          input: buildCodexTurnInput(
            wrapPromptWithSystem(opts.prompt, opts.appendSystemPrompt),
            opts.files,
          ),
        }),
```

- [ ] **Step 5: Pass `files` from the service into `codex.run`**

In `ai-agent-service.ts`, the codex branch calls `this.codex.run({ … })`. Add `files: input.files,` to that options object (the system-prompt note built just above stays — it's the fallback for non-image files).

- [ ] **Step 6: Run to verify it passes + build**

Run: `pnpm vitest run packages/ai-agent/tests/codex-input.test.ts`
Expected: PASS.
Run: `pnpm --filter @anubis/ai-agent build`
Expected: builds clean.

- [ ] **Step 7: Commit**

```bash
git add packages/ai-agent/src/agents/codex/run.ts packages/ai-agent/src/service/ai-agent-service.ts packages/ai-agent/tests/codex-input.test.ts
git commit -m "feat(ai-agent): codex attaches local images via turn/start localImage items"
```

> **Manual verification note (do at the end, Task 11):** `localImage` is the codex app-server input-item type for local image attachment. Confirm against the installed `codex` build — if a turn errors on the image item, the `{{media}}` block + cwd files still let codex read images via its own tool, so degrade by guarding behind a try or removing the image items for that build.

---

## Task 9: Backend route to serve item assets

**Files:**
- Modify: `packages/backend/src/content-items.ts` (add route; imports)
- Create: `packages/backend/tests/content-pipeline/asset-route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/tests/content-pipeline/asset-route.test.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolveItemAssetPath } from '../../src/content-items.js'

describe('resolveItemAssetPath', () => {
  const dataDir = '/data'

  it('resolves a plain filename within the item assets dir', () => {
    const p = resolveItemAssetPath(dataDir, 'c1', '0.jpg')
    expect(p?.replace(/\\/g, '/')).toBe('/data/content-pipeline/c1/assets/0.jpg')
  })

  it('rejects path traversal', () => {
    expect(resolveItemAssetPath(dataDir, 'c1', '../../etc/passwd')).toBeNull()
    expect(resolveItemAssetPath(dataDir, 'c1', '/etc/passwd')).toBeNull()
    expect(resolveItemAssetPath(dataDir, 'c1', 'sub/0.jpg')).toBeNull()
  })

  it('rejects non-image extensions', () => {
    expect(resolveItemAssetPath(dataDir, 'c1', 'video.mp4')).toBeNull()
    expect(resolveItemAssetPath(dataDir, 'c1', 'notes.txt')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run packages/backend/tests/content-pipeline/asset-route.test.ts --maxWorkers=2`
Expected: FAIL — `resolveItemAssetPath` not exported.

- [ ] **Step 3: Implement the helper + route**

In `content-items.ts`, add imports at the top:

```ts
import { createReadStream } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { getDataDir } from './services.js'
import { pipelineItemAssetsDir } from './content-pipeline/assets.js'
```

(merge with existing imports; `getStack` is already imported — check and don't duplicate.)

Add the constant + helper (near the top, after imports):

```ts
const ASSET_IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

/**
 * Resolve a requested item-asset filename to an absolute path, or null if it
 * escapes the item's assets dir or isn't a served image type. Single path
 * segment only — no slashes, no traversal.
 */
export function resolveItemAssetPath(dataDir: string, itemId: string, file: string): string | null {
  if (!file || file !== basename(file)) return null
  const ext = extname(file).toLowerCase()
  if (!ASSET_IMAGE_MIME[ext]) return null
  const dir = pipelineItemAssetsDir(dataDir, itemId)
  const target = resolve(dir, file)
  const root = resolve(dir)
  if (target !== join(root, file)) return null
  if (!target.startsWith(root)) return null
  return target
}
```

Add the route (with the other `contentItemRoutes.get` routes):

```ts
contentItemRoutes.get('/:id/asset', (c) => {
  const file = c.req.query('file')
  if (!file) return c.json({ error: 'missing_file' }, 400)
  const target = resolveItemAssetPath(getDataDir(), c.req.param('id'), file)
  if (!target) return c.json({ error: 'forbidden' }, 403)
  const contentType = ASSET_IMAGE_MIME[extname(target).toLowerCase()]!
  try {
    const stream = createReadStream(target)
    return c.body(stream as unknown as ReadableStream, 200, {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=300',
    })
  } catch {
    return c.json({ error: 'not_found' }, 404)
  }
})
```

> Place this route **before** any `contentItemRoutes.get('/:id', …)` is fine (Hono matches `/:id/asset` distinctly), but keep it grouped with the other GETs. Confirm `getDataDir` is exported from `./services.js` (it is — `factory.ts` imports it).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run packages/backend/tests/content-pipeline/asset-route.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Build the backend**

Run: `pnpm --filter @anubis/backend build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/content-items.ts packages/backend/tests/content-pipeline/asset-route.test.ts
git commit -m "feat(content-items): GET /:id/asset serves item reference images (guarded)"
```

---

## Task 10: Frontend — render local assets in the breakdown/raw-idea sections

**Files:**
- Modify: `packages/frontend/src/lib/artifacts.ts` (add `pipelineAssetUrl`)
- Modify: `packages/frontend/src/pages/content-studio/sections.tsx` (`RawIdeaSection` + a small `AssetThumb`)

- [ ] **Step 1: Add the asset URL builder**

In `packages/frontend/src/lib/artifacts.ts`, append:

```ts
export async function pipelineAssetUrl(itemId: string, fileName: string): Promise<string> {
  const base = await getApiBaseUrl()
  return `${base}/content-items/${encodeURIComponent(itemId)}/asset?file=${encodeURIComponent(fileName)}`
}
```

- [ ] **Step 2: Render `localAssets` in `RawIdeaSection`**

The section components currently receive `raw` but not the item id. `RawIdeaSection` is called in `pipeline-timeline.tsx` as `<RawIdeaSection raw={pipeline.rawIdea} />` and `<RawIdeaSection raw={entry.data as RawIdea} id={id} />`. Thread an optional `itemId` through.

In `sections.tsx`, add an `AssetThumb` and extend `RawIdeaSection`:

```tsx
import { useEffect, useState } from 'react'
import { pipelineAssetUrl } from '@/lib/artifacts'

function AssetThumb({ itemId, fileName }: { itemId: string; fileName: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    pipelineAssetUrl(itemId, fileName).then((u) => { if (!cancelled) setUrl(u) }).catch(() => { if (!cancelled) setUrl(null) })
    return () => { cancelled = true }
  }, [itemId, fileName])
  if (!url) return <div className='h-20 w-20 animate-pulse rounded bg-muted' />
  return <img src={url} alt={fileName} className='h-20 w-20 rounded border border-border object-cover' />
}

export function LocalAssetStrip({ raw, itemId }: { raw: RawIdea; itemId?: string }) {
  const assets = raw.localAssets ?? []
  if (!assets.length) return null
  const images = assets.filter((a) => a.kind === 'image')
  const hasVideo = assets.some((a) => a.kind === 'video')
  return (
    <div className='mt-2'>
      <p className={fieldLabel}>Analyzed media</p>
      <div className='mt-1 flex flex-wrap gap-2'>
        {itemId
          ? images.map((a) => <AssetThumb key={a.fileName} itemId={itemId} fileName={a.fileName} />)
          : images.map((a) => (
            <span key={a.fileName} className='rounded border border-border bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground'>{a.fileName}</span>
          ))}
        {hasVideo ? (
          <span className='inline-flex items-center rounded border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground'>🎬 Video (transcript analyzed)</span>
        ) : null}
      </div>
    </div>
  )
}
```

Then add `itemId` to `RawIdeaSection` and render the strip:

```tsx
export function RawIdeaSection({ raw, id = 'section-raw', itemId }: { raw: RawIdea; id?: string; itemId?: string }) {
  return (
    <Section title='Raw Idea' id={id}>
      <Field label='Caption' value={raw.caption} />
      <Field label='Transcript' value={raw.transcript} />
      <Field label='Source URL' value={raw.sourceUrl} />
      <Field label='Platform' value={raw.sourcePlatform} />
      <Field label='Competitor' value={raw.sourceCompetitor} />
      <Chips label='Assets' items={raw.assetRefs} />
      <LocalAssetStrip raw={raw} itemId={itemId} />
    </Section>
  )
}
```

> Confirm `fieldLabel` is already defined/exported within `sections.tsx` (it is — used by `RefinedSection`). If `RawIdea`/`LocalAsset` aren't imported in `sections.tsx`, add `LocalAsset` to the existing `@anubis/shared` type import (or rely on `raw.localAssets` typing via `RawIdea`).

- [ ] **Step 3: Pass the content id from the timeline**

The id is already available as `pipeline.contentId` (current view) and `entry.contentId` (history) — no new prop threading needed. Import `LocalAssetStrip` (and `RawIdea` if not already imported) at the top of `pipeline-timeline.tsx`:

```tsx
import { AiReviewSection, BriefSection, HumanReviewSection, RawIdeaSection, RefinedSection, LocalAssetStrip } from './sections'
```

In `StepBody` (the `switch (stepKey)`), update the `extract` and `breakdown` cases:

```tsx
    case 'extract':
      return pipeline.rawIdea
        ? <RawIdeaSection raw={pipeline.rawIdea} itemId={pipeline.contentId} />
        : <Empty text='Not extracted yet. Run Auto-run to pull the raw idea from the reference.' />
    case 'breakdown':
      return pipeline.improvedBrief
        ? (
          <>
            {pipeline.rawIdea ? <LocalAssetStrip raw={pipeline.rawIdea as RawIdea} itemId={pipeline.contentId} /> : null}
            <BriefSection brief={pipeline.improvedBrief} lessonsUsed={lessons.map((l) => l.howToImprove)} />
          </>
        )
        : <Empty text='No brief yet.' />
```

In `HistoryOutput` (the `entry` is in scope), update the `extract` case:

```tsx
    case 'extract': return <RawIdeaSection raw={entry.data as RawIdea} id={id} itemId={entry.contentId} />
```

> `Empty` and `RawIdea` are already used in this file; only add the `LocalAssetStrip` import. `entry.contentId` exists on `PipelineHistoryEntry`.

- [ ] **Step 4: Typecheck + test the frontend**

Run: `cd packages/frontend && pnpm vitest run`
Expected: existing tests pass (no new frontend unit test required; rendering is covered by the e2e/manual pass).
Run (from root): `pnpm --filter @anubis/frontend build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/lib/artifacts.ts packages/frontend/src/pages/content-studio/sections.tsx packages/frontend/src/pages/content-studio/pipeline-timeline.tsx
git commit -m "feat(content-studio): render analyzed media (thumbnails + video chip) in the timeline"
```

---

## Task 11: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Rebuild the dependency chain**

Run:
```
pnpm --filter @anubis/shared build
pnpm --filter @anubis/ai-agent build
pnpm --filter @anubis/backend build
pnpm --filter @anubis/frontend build
```
Expected: all clean.

- [ ] **Step 2: Typecheck the whole repo**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Run the affected test suites**

Run:
```
pnpm vitest run packages/backend/tests/content-pipeline --maxWorkers=2
pnpm vitest run packages/ai-agent/tests/codex-input.test.ts
```
Expected: all green. Also run the content-items route test if present.

- [ ] **Step 4: Manual app verification (per the `verify` skill)**

Launch the desktop app, open Content Studio on an item whose reference post is (a) a carousel, (b) a single image, and (c) a video:
- Extract → confirm thumbnails appear in Raw Idea + the "Analyzed media" strip in Breakdown; video shows the transcript + the "Video (transcript analyzed)" chip.
- Run breakdown on a Claude profile for the carousel/image item → confirm the brief reflects visual detail (the agent saw the images).
- Run breakdown on a Codex profile for an image item → confirm no turn error (validate the `localImage` item against the installed codex build; if it errors, apply the degrade noted in Task 8).

- [ ] **Step 5: Final commit if any verification fixes were needed**

```bash
git add -A
git commit -m "fix(content-pipeline): verification follow-ups for media-aware breakdown"
```

---

## Self-review notes (for the implementer)

- **Spec coverage:** §1 acquisition → Tasks 2–4; §2 data model → Task 1; §3 feed-to-AI → Tasks 5–7; §4 agent attach → Task 8 (Claude already native; Codex localImage; Qoder/Antigravity = note+cwd, unchanged by design); §5 UI → Tasks 9–10; §6 testing → throughout + Task 11.
- **No DB migration** — `rawIdea` is a JSON blob; `localAssets` rides along.
- **Type names are consistent:** `LocalAsset`, `materializePostAssets`, `pipelineItemAssetsDir`, `PostMedia`, `buildCodexTurnInput`, `resolveItemAssetPath`, `pipelineAssetUrl`, `LocalAssetStrip` are used identically across tasks.
- **Packaging:** no new third-party dep (only `node:*` + global `fetch`), so no root `package.json` change.
