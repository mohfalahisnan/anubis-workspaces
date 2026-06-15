import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CapturedPostSummary, RawIdea } from '@anubis/shared'
import { runTranscribe } from '../extractor.js'
import { materializePostAssets, type PostMedia } from './assets.js'

/** Transcribe a local video file. Injected so tests stay pure. */
export type TranscribeMedia = (videoPath: string) => Promise<string>
/** Fetch a media URL into a buffer. Injected so tests stay pure. */
export type FetchMedia = (url: string) => Promise<Buffer>

export interface BuildRawIdeaInput {
  post?: CapturedPostSummary
  referenceUrl?: string
  /** Media descriptor from the captured post's `raw.media`, if available. */
  media?: PostMedia
  /** Crawler-cached absolute paths from the post's `raw.assetPaths`, if present. */
  assetPaths?: { absolute: string[]; relative: string[] }
  /** Where to materialize downloaded media (the item's pipeline assets dir). */
  destDir: string
  fetchMedia: FetchMedia
  transcribeMedia: TranscribeMedia
}

export async function buildRawIdea(input: BuildRawIdeaInput): Promise<RawIdea> {
  const { post, referenceUrl } = input
  const assetRefs = post?.mediaUrl ? [post.mediaUrl] : []
  const raw: RawIdea = {
    caption: post?.caption,
    assetRefs,
    sourceUrl: post?.postUrl ?? referenceUrl,
    sourcePlatform: post ? 'instagram' : undefined,
    sourceCompetitor: post?.competitorHandle ?? post?.username,
    mediaKind: post?.mediaKind,
    mediaMetadata: post
      ? { likes: post.likes, comments: post.comments, postedAt: post.postedAt, carouselCount: post.carouselCount }
      : undefined,
  }

  const { assets, transcript } = await materializePostAssets(
    { media: input.media, assetPaths: input.assetPaths, destDir: input.destDir },
    { fetchMedia: input.fetchMedia, transcribe: input.transcribeMedia },
  )
  if (assets.length) raw.localAssets = assets
  if (transcript) raw.transcript = transcript

  return raw
}

/** Real transcriber: run whisper via the extractor CLI on an already-local file. */
export function makeRealTranscriber(): TranscribeMedia {
  return async (videoPath: string) => {
    const result = await runTranscribe(videoPath)
    return result.text
  }
}

/** Real media fetcher: download a URL into a buffer. */
export function makeRealFetchMedia(): FetchMedia {
  return async (url: string) => {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed to download media (${res.status})`)
    return Buffer.from(await res.arrayBuffer())
  }
}

/**
 * Legacy helper retained for callers that still transcribe a remote URL directly
 * (downloads to a temp file first). New code uses makeRealFetchMedia +
 * makeRealTranscriber via materializePostAssets.
 */
export function makeUrlTranscriber(): (mediaUrl: string) => Promise<string> {
  return async (mediaUrl: string) => {
    const res = await fetch(mediaUrl)
    if (!res.ok) throw new Error(`Failed to download media (${res.status})`)
    const buf = Buffer.from(await res.arrayBuffer())
    const dir = mkdtempSync(join(tmpdir(), 'anubis-media-'))
    const file = join(dir, 'media.mp4')
    writeFileSync(file, buf)
    const result = await runTranscribe(file)
    return result.text
  }
}
