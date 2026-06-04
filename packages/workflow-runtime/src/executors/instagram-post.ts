import { z } from 'zod'
import type { Executor } from '../types.js'

const ConfigSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('existing'), postId: z.string().min(1) }),
  z.object({ source: z.literal('url'), url: z.string().url() }),
])

export type InstagramPostConfig = z.infer<typeof ConfigSchema>

export const instagramPostExecutor: Executor<InstagramPostConfig> = {
  type: 'instagramPost',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  async run(input, ctx) {
    if (input.config.source === 'existing') {
      const post = await ctx.db.getCapturedPost(input.config.postId)
      return { kind: 'instagramPost', post }
    }
    const captured = await ctx.crawler.captureProfile(input.config.url)
    return { kind: 'instagramPost', post: captured }
  },
}
