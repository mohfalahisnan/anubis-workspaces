import { z } from 'zod'
import type { Executor } from '../types.js'

const ConfigSchema = z.object({
  staticText: z.string().optional(),
})

export type MarkdownDisplayConfig = z.infer<typeof ConfigSchema>

function findFirstText(upstream: Record<string, unknown>): string | null {
  for (const value of Object.values(upstream)) {
    if (typeof value === 'string') return value
    if (value && typeof value === 'object') {
      const t = (value as { text?: unknown }).text
      if (typeof t === 'string') return t
    }
  }
  return null
}

export const markdownDisplayExecutor: Executor<MarkdownDisplayConfig> = {
  type: 'markdownDisplay',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  async run(input) {
    const text = findFirstText(input.upstream) ?? input.config.staticText ?? ''
    return { kind: 'markdown', text }
  },
}
