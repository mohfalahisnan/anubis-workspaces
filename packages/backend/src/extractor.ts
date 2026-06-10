import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  DEFAULT_WHISPER_MODEL,
  type ExtractWorkspaceJobResult,
  type OcrResult,
  type TranscribeResult,
  type WhisperModel,
} from '@anubis/shared'
import { getStack } from './services.js'
import { jobManager } from './jobs.js'
import { spawnCliJson } from './spawn-cli.js'

/* -----------------------------------------------------------
   Extractor: drives the `anubis-extractor` CLI for OCR and
   audio/video transcription.

   The binary's location is configured per-machine via
   AppConfig.extractorBinaryPath (Settings page). Anubis does
   not bundle or download the binary.

   The CLI is invoked with `--write-sidecar` by default so each
   extraction leaves a `<stem>.anubis.txt` next to the source
   file. The Knowledge Base picks these up on its next index
   pass — that's the integration story between Extractor and
   Knowledge Base.

   Transcription defaults to whisper model `large-v3` per the
   product decision (accuracy over speed; Indonesian content
   benefits). Per-call override via the request body.
   ----------------------------------------------------------- */

const WHISPER_MODELS: WhisperModel[] = ['tiny', 'base', 'small', 'medium', 'large-v3']

function getExtractorBinary(): string {
  const path = getStack().appConfig.get().extractorBinaryPath
  if (!path) {
    throw new Error(
      'Extractor binary not configured. Set the path in Settings → External binaries.',
    )
  }
  return path
}

interface OcrCliOutput {
  text: string
  lines: Array<{ bbox?: [number, number, number, number]; text: string }>
  sidecar_path?: string
  cache_hit?: boolean
}

interface TranscribeCliOutput {
  text: string
  segments: Array<{ start_ms: number; end_ms: number; text: string }>
  language?: string
  sidecar_path?: string
  cache_hit?: boolean
}

export async function runOcr(
  filePath: string,
  opts: { force?: boolean } = {},
): Promise<OcrResult> {
  const binary = getExtractorBinary()
  const args = ['ocr', filePath, '--write-sidecar']
  if (opts.force) args.push('--force')
  const raw = await spawnCliJson<OcrCliOutput>(binary, args)
  return {
    text: raw.text ?? '',
    lines: (raw.lines ?? []).map((line) => ({
      bbox: line.bbox,
      text: line.text,
    })),
    sidecarPath: raw.sidecar_path,
    cacheHit: raw.cache_hit,
  }
}

export interface TranscribeOptions {
  language?: string
  whisperModel?: WhisperModel
  force?: boolean
}

export async function runTranscribe(
  filePath: string,
  opts: TranscribeOptions = {},
): Promise<TranscribeResult> {
  const binary = getExtractorBinary()
  const model = opts.whisperModel ?? DEFAULT_WHISPER_MODEL
  const args = ['transcribe', filePath, '--write-sidecar', '--whisper-model', model]
  if (opts.language) args.push('--language', opts.language)
  if (opts.force) args.push('--force')
  const raw = await spawnCliJson<TranscribeCliOutput>(binary, args)
  return {
    text: raw.text ?? '',
    segments: (raw.segments ?? []).map((seg) => ({
      startMs: seg.start_ms,
      endMs: seg.end_ms,
      text: seg.text,
    })),
    language: raw.language,
    sidecarPath: raw.sidecar_path,
    cacheHit: raw.cache_hit,
  }
}

/* -----------------------------------------------------------
   Workspace-wide extraction
   -----------------------------------------------------------
   Scans a Project's workdir for candidate media, respecting the
   `.anubisignore` at the workspace root (so node_modules, build
   output, .git, etc. are skipped), and runs OCR / transcription
   on each discovered file sequentially. Driven as a background
   job via the shared jobManager so progress streams to the
   top-nav progress bar over SSE.
   ----------------------------------------------------------- */

const ANUBISIGNORE_FILENAME = '.anubisignore'

/** Image extensions eligible for OCR (leading dot, lowercase). */
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.tiff', '.tif', '.bmp', '.gif'])

/** Audio/video extensions eligible for Whisper transcription. */
const MEDIA_EXTS = new Set([
  '.mp3', '.wav', '.m4a', '.flac', '.ogg', '.opus', '.aac',
  '.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v',
])

/**
 * A single `.anubisignore` rule. Patterns are matched against the
 * workspace-relative POSIX path. We support the common gitignore
 * subset actually used in DEFAULT_ANUBISIGNORE: comments, blank
 * lines, trailing-slash directory markers, leading-slash anchoring,
 * and `*` wildcards (no `**` or `?` — not needed here).
 */
interface IgnoreRule {
  /** Compiled matcher over a relative POSIX path. */
  test: (relPosix: string, isDir: boolean) => boolean
}

function getProjectWorkdir(projectId: string): string {
  const project = getStack().projects.findById(projectId)
  if (!project) throw new Error(`Project ${projectId} not found.`)
  if (!project.workdir) {
    throw new Error(
      `Project "${project.name}" has no workdir. Set a workspace path on the project before extracting it.`,
    )
  }
  if (!existsSync(project.workdir)) {
    throw new Error(`Project workdir does not exist on disk: ${project.workdir}`)
  }
  return project.workdir
}

/** Translate one `.anubisignore` glob segment into a RegExp source. */
function globToRegExpSource(glob: string): string {
  let src = ''
  for (const ch of glob) {
    if (ch === '*') src += '[^/]*'
    else src += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  }
  return src
}

function parseAnubisIgnore(workdir: string): IgnoreRule[] {
  const target = join(workdir, ANUBISIGNORE_FILENAME)
  if (!existsSync(target)) return []
  let content: string
  try {
    content = readFileSync(target, 'utf8')
  } catch {
    return []
  }

  const rules: IgnoreRule[] = []
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    // Negation (`!`) is uncommon in our default file; treat as a no-op
    // (i.e. don't un-ignore) to keep matching conservative.
    if (line.startsWith('!')) continue

    const dirOnly = line.endsWith('/')
    let body = dirOnly ? line.slice(0, -1) : line
    const anchored = body.startsWith('/')
    if (anchored) body = body.slice(1)
    if (!body) continue

    const re = new RegExp(`^${globToRegExpSource(body)}$`)

    rules.push({
      test: (relPosix, isDir) => {
        if (dirOnly && !isDir) return false
        if (anchored) {
          // Anchored: match the first path segment only.
          const first = relPosix.split('/')[0] ?? relPosix
          return re.test(first)
        }
        // Unanchored: match the basename or any path segment.
        const segments = relPosix.split('/')
        return segments.some((s) => re.test(s))
      },
    })
  }
  return rules
}

function isIgnored(rules: IgnoreRule[], relPosix: string, isDir: boolean): boolean {
  return rules.some((r) => r.test(relPosix, isDir))
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot).toLowerCase()
}

export interface ScannedFile {
  path: string
  kind: 'ocr' | 'transcribe'
}

/**
 * Walk the workspace, returning candidate files of the requested
 * kinds. `.anubisignore` directory/path rules prune the tree, but a
 * file whose extension matches a *selected* extraction kind is
 * always kept — otherwise the default ignore (which lists `*.mp4`)
 * would silently exclude the very media the user asked to extract.
 */
export function scanWorkspaceFiles(
  workdir: string,
  opts: { images: boolean; media: boolean },
): ScannedFile[] {
  const rules = parseAnubisIgnore(workdir)
  const found: ScannedFile[] = []

  const walk = (dir: string): void => {
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name)
      const rel = relative(workdir, abs).split(sep).join('/')
      const isDir = entry.isDirectory()

      if (isDir) {
        // Always skip the AI/system + VCS folders even if no ignore file.
        if (entry.name === 'node_modules' || entry.name === '.git') continue
        if (isIgnored(rules, rel, true)) continue
        walk(abs)
        continue
      }
      if (!entry.isFile()) continue

      const ext = extOf(entry.name)
      const isImage = opts.images && IMAGE_EXTS.has(ext)
      const isMedia = opts.media && MEDIA_EXTS.has(ext)
      if (!isImage && !isMedia) continue

      // A selected target extension overrides `.anubisignore` file-glob
      // exclusions (e.g. the default file ignores *.mp4). Directory
      // pruning above still applies.
      found.push({ path: abs, kind: isImage ? 'ocr' : 'transcribe' })
    }
  }

  walk(workdir)
  // Stable order so progress is intuitive (images, then media, alpha).
  found.sort((a, b) => a.path.localeCompare(b.path))
  return found
}

export interface ExtractWorkspaceOptions {
  projectId: string
  images: boolean
  media: boolean
  force?: boolean
  language?: string
  whisperModel?: WhisperModel
}

/**
 * Enqueue a workspace-extraction background job. Returns the job id
 * immediately; progress + result stream over the jobs SSE feed.
 */
export function startWorkspaceExtraction(
  opts: ExtractWorkspaceOptions,
  projectLabel?: string,
): string {
  // Validate up front so the HTTP caller gets a clean 4xx/5xx instead of a
  // job that fails on its first tick.
  const workdir = getProjectWorkdir(opts.projectId)
  getExtractorBinary()

  const label = `Extract workspace${projectLabel ? ` · ${projectLabel}` : ''}`

  const job = jobManager.runJob<ExtractWorkspaceJobResult>(
    { kind: 'extract-workspace', label, projectId: opts.projectId },
    async (ctx) => {
      const files = scanWorkspaceFiles(workdir, { images: opts.images, media: opts.media })
      const result: ExtractWorkspaceJobResult = {
        totalCount: files.length,
        processedCount: 0,
        cachedCount: 0,
        failedCount: 0,
        imageCount: 0,
        mediaCount: 0,
      }

      ctx.reporter.start('extract', files.length)
      if (files.length === 0) {
        ctx.reporter.done('extract')
        return result
      }

      let completed = 0
      for (const file of files) {
        // Show the file about to be processed.
        ctx.setProgress({
          phase: 'extract',
          current: completed,
          total: files.length,
          note: relative(workdir, file.path).split(sep).join('/'),
        })
        try {
          if (file.kind === 'ocr') {
            const r = await runOcr(file.path, { force: opts.force })
            result.imageCount++
            if (r.cacheHit) result.cachedCount++
          } else {
            const r = await runTranscribe(file.path, {
              force: opts.force,
              language: opts.language,
              whisperModel: opts.whisperModel,
            })
            result.mediaCount++
            if (r.cacheHit) result.cachedCount++
          }
          result.processedCount++
        } catch (err) {
          result.failedCount++
          const msg = err instanceof Error ? err.message : String(err)
          ctx.warn(`${relative(workdir, file.path).split(sep).join('/')}: ${msg}`)
        } finally {
          completed++
          ctx.reporter.update('extract', completed, `${completed}/${files.length}`)
        }
      }

      ctx.reporter.done('extract')
      return result
    },
  )

  return job.id
}

/* -----------------------------------------------------------
   HTTP routes — drive the binary from the renderer's Extractor
   page. Not documented in anubis-core SKILL.md by design; the
   agent reaches extraction via the workflow nodes only.
   ----------------------------------------------------------- */

const OcrBody = z.object({
  path: z.string().min(1),
  force: z.boolean().optional(),
}).strict()

const TranscribeBody = z.object({
  path: z.string().min(1),
  language: z.string().min(2).max(8).optional(),
  whisperModel: z.enum(WHISPER_MODELS as [WhisperModel, ...WhisperModel[]]).optional(),
  force: z.boolean().optional(),
}).strict()

const WorkspaceBody = z.object({
  projectId: z.string().min(1),
  /** OCR images (.png/.jpg/.jpeg/.webp/…). */
  images: z.boolean().optional(),
  /** Transcribe audio/video (.mp4/.m4a/.mp3/.wav/…). */
  media: z.boolean().optional(),
  /** Ignore existing `<stem>.anubis.txt` sidecars and re-extract. */
  force: z.boolean().optional(),
  language: z.string().min(2).max(8).optional(),
  whisperModel: z.enum(WHISPER_MODELS as [WhisperModel, ...WhisperModel[]]).optional(),
}).strict().refine((b) => b.images || b.media, {
  message: 'Select at least one of images or media to extract.',
})

export const extractorRoutes = new Hono()

extractorRoutes.post('/ocr', async (c) => {
  const body = OcrBody.parse(await c.req.json())
  const result = await runOcr(body.path, { force: body.force })
  return c.json({ ok: true, result })
})

extractorRoutes.post('/transcribe', async (c) => {
  const body = TranscribeBody.parse(await c.req.json())
  const result = await runTranscribe(body.path, {
    language: body.language,
    whisperModel: body.whisperModel,
    force: body.force,
  })
  return c.json({ ok: true, result })
})

extractorRoutes.post('/workspace', async (c) => {
  const body = WorkspaceBody.parse(await c.req.json())
  const project = getStack().projects.findById(body.projectId)
  const jobId = startWorkspaceExtraction(
    {
      projectId: body.projectId,
      images: body.images ?? false,
      media: body.media ?? false,
      force: body.force,
      language: body.language,
      whisperModel: body.whisperModel,
    },
    project?.name,
  )
  return c.json({ ok: true, jobId })
})
