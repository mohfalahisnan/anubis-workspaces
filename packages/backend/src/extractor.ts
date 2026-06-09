import { Hono } from 'hono'
import { z } from 'zod'
import {
  DEFAULT_WHISPER_MODEL,
  type OcrResult,
  type TranscribeResult,
  type WhisperModel,
} from '@anubis/shared'
import { getStack } from './services.js'
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
