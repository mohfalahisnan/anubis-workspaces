import { z } from 'zod'
import type { Executor, CapturedPost } from '../types.js'
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
  assetPaths: {
    absolute: string[]
    relative: string[]
  }
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
    let captured: CapturedPost
    if (input.config.source === 'existing') {
      const dbPost = await ctx.db.getCapturedPost(input.config.postId)
      const url = dbPost.postUrl || dbPost.id
      captured = await ctx.crawler.captureProfile(url)
    } else {
      captured = await ctx.crawler.captureProfile(input.config.url)
    }

    let mediaPaths: string[] = []
    let mediaErrors: string[] = []
    let assetPaths: { absolute: string[]; relative: string[] }

    if (captured.assetPaths) {
      assetPaths = captured.assetPaths as { absolute: string[]; relative: string[] }
      mediaPaths = assetPaths.absolute
      if (captured.failedAssets && Array.isArray(captured.failedAssets)) {
        mediaErrors = captured.failedAssets.map((url) => `${url} → download failed`)
      }
    } else {
      // Fallback for when assetPaths is missing (e.g. in legacy data or unit tests)
      for (let i = 0; i < captured.mediaUrls.length; i++) {
        const url = captured.mediaUrls[i]!
        try {
          const { path } = await downloadToArtifact(url, ctx, `${input.nodeId}-media-${i}`)
          mediaPaths.push(path)
        } catch (err) {
          mediaErrors.push(`${url} → ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      assetPaths = {
        absolute: mediaPaths,
        relative: mediaPaths,
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
        assetPaths,
      },
    }
  },
}
