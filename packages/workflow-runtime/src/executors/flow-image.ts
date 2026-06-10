import { z } from 'zod'
import type { Executor } from '../types.js'

const ConfigSchema = z.object({
  prompt: z.string().optional(),
  projectUrl: z.string().optional(),
  ratio: z.enum(['16:9', '4:3', '1:1', '3:4', '9:16']).optional(),
  variations: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  model: z.string().optional(),
  downloadDir: z.string().optional(),
})

export type FlowImageConfig = z.infer<typeof ConfigSchema>

/** Pull a usable prompt string out of an upstream node's output value. */
function textFromValue(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return null
  const v = value as { kind?: string; text?: unknown; value?: unknown }
  if (v.kind === 'text' && typeof v.text === 'string') return v.text
  if (v.kind === 'json') return textFromValue(v.value)
  return null
}

function findFirstText(upstream: Record<string, unknown>): string | null {
  for (const value of Object.values(upstream)) {
    const text = textFromValue(value)
    if (text && text.trim()) return text.trim()
  }
  return null
}

export const flowImageExecutor: Executor<FlowImageConfig> = {
  type: 'flowImage',
  validateConfig(raw) {
    return ConfigSchema.parse(raw ?? {})
  },
  async run(input, ctx) {
    const prompt = input.config.prompt?.trim() || findFirstText(input.upstream)
    if (!prompt) throw new Error('flowImage: no prompt provided in config or found upstream')
    const result = await ctx.flow.generate({
      prompt,
      projectUrl: input.config.projectUrl?.trim() || undefined,
      ratio: input.config.ratio,
      variations: input.config.variations,
      model: input.config.model?.trim() || undefined,
      downloadDir: input.config.downloadDir?.trim() || undefined,
    })
    return { kind: 'json', value: result }
  },
}
