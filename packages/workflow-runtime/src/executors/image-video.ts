import { z } from 'zod'
import { stat as fsStat } from 'node:fs/promises'
import type { Executor } from '../types.js'
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

export const imageVideoExecutor: Executor<ImageVideoConfig> = {
  type: 'imageVideo',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  async run(input, ctx): Promise<ImageVideoOutput> {
    if (input.config.source === 'local') {
      const localPath = input.config.path
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
    const { path, mimeType, sizeBytes } = await downloadToArtifact(input.config.url, ctx, input.nodeId)
    return { kind: 'file', path, mimeType, sizeBytes, origin: 'url' }
  },
}
