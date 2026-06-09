import { z } from 'zod'
import type { Executor } from '../types.js'

const ConfigSchema = z.object({
  mediaPath: z.string().optional(),
  language: z.string().optional(),
  whisperModel: z.enum(['tiny', 'base', 'small', 'medium', 'large-v3']).optional(),
  force: z.boolean().optional(),
})

export type TranscriberConfig = z.infer<typeof ConfigSchema>

function pathFromValue(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const v = value as { kind?: string; path?: unknown; files?: unknown; value?: unknown }
  if (v.kind === 'file' && typeof v.path === 'string') return v.path
  if (v.kind === 'files' && Array.isArray(v.files)) {
    for (const item of v.files) {
      const path = pathFromValue(item)
      if (path) return path
    }
  }
  if (v.kind === 'json' && Object.prototype.hasOwnProperty.call(v, 'value')) {
    return pathFromValue(v.value)
  }
  return null
}

function findFirstFilePath(upstream: Record<string, unknown>): string | null {
  for (const value of Object.values(upstream)) {
    const path = pathFromValue(value)
    if (path) return path
  }
  return null
}

export const transcriberExecutor: Executor<TranscriberConfig> = {
  type: 'transcriber',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  async run(input, ctx) {
    const path = input.config.mediaPath ?? findFirstFilePath(input.upstream)
    if (!path) throw new Error('transcriber: no media path provided or found upstream')
    const result = await ctx.transcribe.fromMedia(path, {
      language: input.config.language,
      whisperModel: input.config.whisperModel,
      force: input.config.force,
    })
    return {
      kind: 'json',
      value: {
        text: result.text,
        segments: result.segments,
        language: result.language,
        sidecarPath: result.sidecarPath,
        cacheHit: result.cacheHit,
      },
    }
  },
}
