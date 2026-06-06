import { z } from 'zod'
import type { Executor } from '../types.js'
import { firstUpstreamText } from './_text.js'

const ConfigSchema = z.object({
  staticText: z.string().optional(),
})

export type OriginalCopyConfig = z.infer<typeof ConfigSchema>

export interface OriginalCopyOutput {
  kind: 'originalCopy'
  text: string
}

/**
 * Pull the *original* copywriting out of an upstream map. Prefers a real
 * caption over any prose a sibling node (e.g. an AI analyst) produced, so the
 * node shows the source copy even when wired alongside analysis nodes:
 *   1. `value.post.caption` — the Instagram Post output shape.
 *   2. `value.caption`      — a captured-post-like value.
 * Returns null if no upstream value carries a caption.
 */
function firstUpstreamCaption(upstream: Record<string, unknown>): string | null {
  for (const value of Object.values(upstream)) {
    if (!value || typeof value !== 'object') continue
    const post = (value as { post?: unknown }).post
    if (post && typeof post === 'object') {
      const caption = (post as { caption?: unknown }).caption
      if (typeof caption === 'string') return caption
    }
    const caption = (value as { caption?: unknown }).caption
    if (typeof caption === 'string') return caption
  }
  return null
}

/**
 * Display-only node that surfaces the original copywriting (the source caption)
 * from upstream content. Caption-aware so it can sit downstream of an analyst
 * while still showing the true original; falls back to generic upstream text,
 * then to a configured static fallback.
 */
export const originalCopyExecutor: Executor<OriginalCopyConfig> = {
  type: 'originalCopy',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  async run(input): Promise<OriginalCopyOutput> {
    const text =
      firstUpstreamCaption(input.upstream) ??
      firstUpstreamText(input.upstream) ??
      input.config.staticText ??
      ''
    return { kind: 'originalCopy', text }
  },
}
