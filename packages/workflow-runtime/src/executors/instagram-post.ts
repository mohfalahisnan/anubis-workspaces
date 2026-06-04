import { z } from 'zod'
import type { Executor } from '../types.js'
import { downloadToArtifact } from './_media-utils.js'

const ConfigSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('existing'), postId: z.string().min(1) }),
  z.object({ source: z.literal('url'), url: z.string().url() }),
])

export type InstagramPostConfig = z.infer<typeof ConfigSchema>

export interface InstagramPostOutputPost {
  id: string
  caption?: string
  /** Local file paths for the post's media, downloaded into the run's artifact dir. */
  mediaPaths: string[]
  /** Per-media download failures (e.g. private CDN URL), if any. */
  mediaErrors?: string[]
  metrics?: { likes?: number; comments?: number }
}

export interface InstagramPostOutput {
  kind: 'instagramPost'
  post: InstagramPostOutputPost
}

export const instagramPostExecutor: Executor<InstagramPostConfig> = {
  type: 'instagramPost',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  async run(input, ctx): Promise<InstagramPostOutput> {
    const captured =
      input.config.source === 'existing'
        ? await ctx.db.getCapturedPost(input.config.postId)
        : await ctx.crawler.captureProfile(input.config.url)

    // Download each media URL to a run artifact so downstream nodes (and the
    // AI Agent's prompt context) only see short file paths, not the 1–2 KB
    // signed CDN URLs that bust Windows' 8K cmd.exe limit.
    const mediaPaths: string[] = []
    const mediaErrors: string[] = []
    for (let i = 0; i < captured.mediaUrls.length; i++) {
      const url = captured.mediaUrls[i]!
      try {
        const { path } = await downloadToArtifact(url, ctx, `${input.nodeId}-media-${i}`)
        mediaPaths.push(path)
      } catch (err) {
        mediaErrors.push(`${url} → ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return {
      kind: 'instagramPost',
      post: {
        id: captured.id,
        caption: captured.caption,
        mediaPaths,
        ...(mediaErrors.length > 0 ? { mediaErrors } : {}),
        ...(captured.metrics ? { metrics: captured.metrics } : {}),
      },
    }
  },
}
