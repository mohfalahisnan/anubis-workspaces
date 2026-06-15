import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { LocalAsset } from '@anubis/shared'

/** The on-disk dir where an item's reference media is materialized. */
export function pipelineItemAssetsDir(dataDir: string, itemId: string): string {
  return join(dataDir, 'content-pipeline', itemId, 'assets')
}

export interface PostMedia {
  kind: 'image' | 'video' | 'carousel'
  urls?: string[]
  videoUrl?: string
}

export interface MaterializeDeps {
  /** Fetch a media URL into a buffer. Injected so tests stay pure. */
  fetchMedia: (url: string) => Promise<Buffer>
  /** Transcribe a local video file. Injected so tests stay pure. */
  transcribe: (videoPath: string) => Promise<string>
}

export interface MaterializeInput {
  media?: PostMedia
  /** Crawler-cached absolute paths, when capture already downloaded the media. */
  assetPaths?: { absolute: string[]; relative: string[] }
  destDir: string
}

export interface MaterializeResult {
  assets: LocalAsset[]
  transcript?: string
}

interface Planned {
  url: string
  fileName: string
  kind: LocalAsset['kind']
}

/** The download plan for a post's media — mirrors the crawler's downloadPostAssets. */
function planDownloads(media: PostMedia): Planned[] {
  const out: Planned[] = []
  if (media.kind === 'video') {
    if (media.urls?.[0]) out.push({ url: media.urls[0], fileName: '0.jpg', kind: 'image' })
    if (media.videoUrl) out.push({ url: media.videoUrl, fileName: 'video.mp4', kind: 'video' })
  } else if (media.kind === 'carousel') {
    media.urls?.forEach((url, i) => out.push({ url, fileName: `${i}.jpg`, kind: 'image' }))
    if (media.videoUrl) out.push({ url: media.videoUrl, fileName: 'video.mp4', kind: 'video' })
  } else if (media.kind === 'image') {
    if (media.urls?.[0]) out.push({ url: media.urls[0], fileName: '0.jpg', kind: 'image' })
  }
  return out
}

function classify(fileName: string): LocalAsset['kind'] {
  return extname(fileName).toLowerCase() === '.mp4' ? 'video' : 'image'
}

/**
 * Materialize a reference post's media into `destDir`, reusing crawler-cached
 * files when present. Returns the local assets and (for video) a transcript.
 * Per-asset failures are logged, never thrown — one bad slide or a silent
 * video must not kill the extract step.
 */
export async function materializePostAssets(
  input: MaterializeInput,
  deps: MaterializeDeps,
): Promise<MaterializeResult> {
  // Reuse path: capture already downloaded everything.
  const cached = input.assetPaths?.absolute?.filter((p) => existsSync(p)) ?? []
  if (cached.length > 0) {
    const assets: LocalAsset[] = cached.map((p) => ({ kind: classify(p), fileName: basename(p), path: p }))
    const video = assets.find((a) => a.kind === 'video')
    const transcript = video ? await safeTranscribe(deps, video.path) : undefined
    return { assets, transcript }
  }

  if (!input.media) return { assets: [] }

  mkdirSync(input.destDir, { recursive: true })
  const assets: LocalAsset[] = []
  for (const item of planDownloads(input.media)) {
    const target = join(input.destDir, item.fileName)
    try {
      if (!existsSync(target)) {
        const buf = await deps.fetchMedia(item.url)
        writeFileSync(target, buf)
      }
      assets.push({ kind: item.kind, fileName: item.fileName, path: target, sourceUrl: item.url })
    } catch (err) {
      console.warn(
        `[content-pipeline] failed to download ${item.url}: `
        + (err instanceof Error ? err.message : String(err)),
      )
    }
  }

  const video = assets.find((a) => a.kind === 'video')
  const transcript = video ? await safeTranscribe(deps, video.path) : undefined
  return { assets, transcript }
}

async function safeTranscribe(deps: MaterializeDeps, videoPath: string): Promise<string | undefined> {
  try {
    return await deps.transcribe(videoPath)
  } catch (err) {
    console.warn(
      `[content-pipeline] transcription failed for ${videoPath}; continuing without a transcript: `
      + (err instanceof Error ? err.message : String(err)),
    )
    return undefined
  }
}
