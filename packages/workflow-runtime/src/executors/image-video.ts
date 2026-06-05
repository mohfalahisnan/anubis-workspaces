import { z } from 'zod'
import { stat as fsStat } from 'node:fs/promises'
import type { Executor, ExecutorContext } from '../types.js'
import { downloadToArtifact, pickExtension } from './_media-utils.js'

/**
 * imageVideo — a source/transform node for media files.
 *
 *   - source: 'url'    → fetch the URL, save the bytes into the run's artifact
 *                        directory, output the file path. Downstream nodes
 *                        (OCR, AI Agent, etc.) only ever see the short path.
 *   - source: 'local'  → use an existing local file path as-is. No download.
 *                        Useful when the user has media on disk they want to
 *                        feed into the workflow without round-tripping
 *                        through a URL.
 *
 * Output shape matches `transformerMedia` so downstream consumers (OCR
 * Extractor, Transformer Brief, etc.) can chain freely from either.
 */
const ConfigSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('url'), url: z.string().url() }),
  z.object({ source: z.literal('local'), path: z.string().min(1) }),
  z.object({ source: z.literal('upstream'), inputPath: z.string().optional() }),
])

export type ImageVideoConfig = z.infer<typeof ConfigSchema>

export interface ImageVideoOutput {
  kind: 'file'
  path: string
  mimeType?: string
  sizeBytes?: number
  /** Whether the file was downloaded for this run ('url') or referenced as-is ('local'). */
  origin: 'url' | 'local'
}

export interface ImageVideoArrayOutput {
  kind: 'files'
  files: ImageVideoOutput[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function resolvePath(root: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.').filter(Boolean)
  let current: unknown = root
  for (const part of parts) {
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      current = current[Number(part)]
    } else if (isRecord(current)) {
      current = current[part]
    } else {
      throw new Error(`imageVideo: missing path: ${path}`)
    }
    if (current === undefined) throw new Error(`imageVideo: missing path: ${path}`)
  }
  return current
}

function pickUpstream(upstream: Record<string, unknown>, inputPath?: string): unknown {
  const scope = { upstream, ...upstream }
  if (inputPath?.trim()) return resolvePath(scope, inputPath.trim())
  const values = Object.values(upstream)
  return values.length === 1 ? values[0] : upstream
}

async function localFileOutput(localPath: string): Promise<ImageVideoOutput> {
  const info = await fsStat(localPath).catch((err) => {
    throw new Error(`imageVideo: local path not readable (${localPath}): ${err instanceof Error ? err.message : String(err)}`)
  })
  if (!info.isFile()) {
    throw new Error(`imageVideo: local path is not a file: ${localPath}`)
  }
  return {
    kind: 'file',
    path: localPath,
    mimeType: pickExtension(undefined, localPath) === 'bin' ? undefined : `image/${pickExtension(undefined, localPath)}`,
    sizeBytes: info.size,
    origin: 'local',
  }
}

async function urlFileOutput(url: string, ctx: ExecutorContext, nodeId: string): Promise<ImageVideoOutput> {
  const { path, mimeType, sizeBytes } = await downloadToArtifact(url, ctx, nodeId)
  return { kind: 'file', path, mimeType, sizeBytes, origin: 'url' }
}

function collectMediaInputs(value: unknown): Array<{ source: 'url' | 'local'; value: string }> {
  if (typeof value === 'string') {
    return [{ source: /^https?:\/\//i.test(value) || value.startsWith('data:') ? 'url' : 'local', value }]
  }

  if (Array.isArray(value)) return value.flatMap((item) => collectMediaInputs(item))

  if (!isRecord(value)) return []

  if (value.kind === 'file' && typeof value.path === 'string') {
    return [{ source: 'local', value: value.path }]
  }

  if (value.kind === 'json' && Object.prototype.hasOwnProperty.call(value, 'value')) {
    return collectMediaInputs(value.value)
  }

  if (value.kind === 'files' && Array.isArray(value.files)) {
    return value.files.flatMap((item) => collectMediaInputs(item))
  }

  if (typeof value.url === 'string') return [{ source: 'url', value: value.url }]
  if (typeof value.path === 'string') return [{ source: 'local', value: value.path }]
  if (Array.isArray(value.urls)) return value.urls.flatMap((item) => collectMediaInputs(item))
  if (Array.isArray(value.paths)) return value.paths.flatMap((item) => collectMediaInputs(item))
  if (Array.isArray(value.mediaUrls)) return value.mediaUrls.flatMap((item) => collectMediaInputs(item))
  if (Array.isArray(value.mediaPaths)) return value.mediaPaths.flatMap((item) => collectMediaInputs(item))

  return []
}

export const imageVideoExecutor: Executor<ImageVideoConfig> = {
  type: 'imageVideo',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  async run(input, ctx): Promise<ImageVideoOutput | ImageVideoArrayOutput> {
    if (input.config.source === 'local') {
      return localFileOutput(input.config.path)
    }
    if (input.config.source === 'url') return urlFileOutput(input.config.url, ctx, input.nodeId)

    const mediaInputs = collectMediaInputs(pickUpstream(input.upstream, input.config.inputPath))
    if (mediaInputs.length === 0) throw new Error('imageVideo: no upstream media array found')
    const files = await Promise.all(mediaInputs.map((item, index) => (
      item.source === 'local'
        ? localFileOutput(item.value)
        : urlFileOutput(item.value, ctx, `${input.nodeId}-${index}`)
    )))
    return { kind: 'files', files }
  },
}
