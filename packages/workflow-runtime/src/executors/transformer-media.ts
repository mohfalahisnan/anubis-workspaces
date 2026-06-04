import { z } from 'zod'
import type { Executor } from '../types.js'

const ConfigSchema = z.object({
  url: z.string().url().optional(),
})

export type TransformerMediaConfig = z.infer<typeof ConfigSchema>

function findFirstMediaUrl(upstream: Record<string, unknown>): string | null {
  for (const value of Object.values(upstream)) {
    if (value && typeof value === 'object') {
      const post = (value as { post?: { mediaUrls?: unknown } }).post
      const urls = post?.mediaUrls
      if (Array.isArray(urls) && typeof urls[0] === 'string') return urls[0]
    }
  }
  return null
}

const EXT_FROM_MIME: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
  'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm',
}

function pickExt(mimeType: string | null, url: string): string {
  if (mimeType && EXT_FROM_MIME[mimeType]) return EXT_FROM_MIME[mimeType]
  const m = url.match(/\.([a-z0-9]{1,5})(?:[?#]|$)/i)
  return m && m[1] ? m[1].toLowerCase() : 'bin'
}

export const transformerMediaExecutor: Executor<TransformerMediaConfig> = {
  type: 'transformerMedia',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  async run(input, ctx) {
    const url = input.config.url ?? findFirstMediaUrl(input.upstream)
    if (!url) throw new Error('transformerMedia: no url provided or found upstream')
    const response = await fetch(url)
    const buffer = Buffer.from(await response.arrayBuffer())
    const mimeType = response.headers.get('content-type')
    const ext = pickExt(mimeType, url)
    const path = await ctx.fs.writeRunArtifact(ctx.runId, input.nodeId, ext, buffer)
    return { kind: 'file', path, mimeType: mimeType ?? undefined, sizeBytes: buffer.length }
  },
}
