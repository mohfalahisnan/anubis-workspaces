import { z } from 'zod'
import type { Executor } from '../types.js'
import { firstUpstreamText } from './_text.js'

const ConfigSchema = z.object({
  staticText: z.string().optional(),
})

export type MarkdownDisplayConfig = z.infer<typeof ConfigSchema>

export const markdownDisplayExecutor: Executor<MarkdownDisplayConfig> = {
  type: 'markdownDisplay',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  async run(input) {
    const text = firstUpstreamText(input.upstream) ?? input.config.staticText ?? ''
    return { kind: 'markdown', text }
  },
}
