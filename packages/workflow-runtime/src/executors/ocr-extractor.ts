import { z } from 'zod'
import type { Executor } from '../types.js'

const ConfigSchema = z.object({
  imagePath: z.string().optional(),
})

export type OcrExtractorConfig = z.infer<typeof ConfigSchema>

function findFirstFilePath(upstream: Record<string, unknown>): string | null {
  for (const value of Object.values(upstream)) {
    if (value && typeof value === 'object') {
      const v = value as { kind?: string; path?: unknown }
      if (v.kind === 'file' && typeof v.path === 'string') return v.path
    }
  }
  return null
}

export const ocrExtractorExecutor: Executor<OcrExtractorConfig> = {
  type: 'ocrExtractor',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  async run(input, ctx) {
    const path = input.config.imagePath ?? findFirstFilePath(input.upstream)
    if (!path) throw new Error('ocrExtractor: no image path provided or found upstream')
    const text = await ctx.ocr.extractFromImage(path)
    return { kind: 'text', text }
  },
}
