/**
 * Shared helpers for executors that need to persist media to the run's
 * artifact directory. Used by instagramPostExecutor (downloads each post's
 * media URLs) and imageVideoExecutor (downloads a single URL or accepts a
 * local file path).
 *
 * Materialising media to files solves two problems:
 *
 *   1. Signed CDN URLs (Instagram, etc.) are 1–2 KB each. When the AI Agent
 *      executor JSON-stringifies the upstream context for its prompt, a
 *      handful of URLs can blow past the Windows 8191-char cmd.exe limit
 *      and the agent process fails before it even sees the prompt.
 *      Short file paths (~100 chars) keep prompts comfortably small.
 *
 *   2. Subsequent nodes (transformer-media, ocr-extractor) need a real file
 *      on disk to read, not a remote URL. Doing the download once at the
 *      source means downstream nodes don't have to refetch.
 */

import type { ExecutorContext } from '../types.js'

const EXT_FROM_MIME: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/avif': 'avif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
}

export function pickExtension(mimeType: string | null | undefined, url: string): string {
  if (mimeType && EXT_FROM_MIME[mimeType.split(';')[0]!.trim()]) {
    return EXT_FROM_MIME[mimeType.split(';')[0]!.trim()]!
  }
  const m = url.match(/\.([a-z0-9]{1,5})(?:[?#]|$)/i)
  return m && m[1] ? m[1].toLowerCase() : 'bin'
}

export interface DownloadResult {
  path: string
  mimeType?: string
  sizeBytes: number
}

/**
 * Fetch the URL, write the bytes to a run artifact, and return its path.
 * `nodeIdSuffix` becomes part of the filename so multiple downloads from
 * the same node don't collide.
 */
export async function downloadToArtifact(
  url: string,
  ctx: ExecutorContext,
  nodeIdSuffix: string,
): Promise<DownloadResult> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`download failed (${response.status}) for ${url}`)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  const mimeType = response.headers.get('content-type') ?? undefined
  const ext = pickExtension(mimeType, url)
  const path = await ctx.fs.writeRunArtifact(ctx.runId, nodeIdSuffix, ext, buffer)
  return { path, mimeType, sizeBytes: buffer.length }
}
