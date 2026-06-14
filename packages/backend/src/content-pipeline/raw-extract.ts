import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CapturedPostSummary, RawIdea } from '@anubis/shared'
import { runTranscribe } from '../extractor.js'

/** Download `mediaUrl` and return transcript text. Injected so tests stay pure. */
export type TranscribeMedia = (mediaUrl: string) => Promise<string>

export interface BuildRawIdeaInput {
  post?: CapturedPostSummary
  referenceUrl?: string
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

  if (post?.mediaKind === 'video' && post.mediaUrl) {
    // Best-effort: a silent / no-audio-track video makes the extractor's ffmpeg
    // step fail ("Output file does not contain any stream", exit -22). That must
    // not kill the whole extract step — fall back to caption-only.
    try {
      raw.transcript = await input.transcribeMedia(post.mediaUrl)
    } catch (err) {
      console.warn(
        `[content-pipeline] transcription failed for ${post.mediaUrl}; continuing without a transcript: `
        + (err instanceof Error ? err.message : String(err)),
      )
    }
  }
  // image / carousel: no OCR by default (Phase 1).

  return raw
}

/** Real transcriber: fetch the media to a temp file, then run whisper via the extractor CLI. */
export function makeRealTranscriber(): TranscribeMedia {
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
