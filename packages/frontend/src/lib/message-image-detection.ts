import {
  imageFilenameFromSource,
  isImageReferenceSource,
  type MessageImageReference,
} from '@anubis/shared'

export type MarkdownImageSegment =
  | { kind: 'markdown'; text: string }
  | { kind: 'image'; ref: MessageImageReference }

const RAW_IMAGE_PATH_RE =
  /(?:[A-Za-z]:[\\/][^\r\n"'`<>]*?\.(?:png|jpe?g|gif|webp)(?:[?#][^\s"'`<>]*)?|\.{1,2}[\\/][^\r\n"'`<>]*?\.(?:png|jpe?g|gif|webp)(?:[?#][^\s"'`<>]*)?|[A-Za-z0-9_.-]+[\\/][^\r\n"'`<>]*?\.(?:png|jpe?g|gif|webp)(?:[?#][^\s"'`<>]*)?|[A-Za-z0-9_.-]+\.(?:png|jpe?g|gif|webp)(?:[?#][^\s"'`<>]*)?)/gi

export function splitMarkdownImageReferences(source: string): MarkdownImageSegment[] {
  const segments: MarkdownImageSegment[] = []
  for (const region of splitCodeRegions(source)) {
    if (region.protected) {
      pushMarkdown(segments, region.text)
      continue
    }
    splitMarkdownImages(region.text, segments)
  }
  return segments
}

export function extractImageReferencesFromMarkdown(source: string): MessageImageReference[] {
  const refs: MessageImageReference[] = []
  const seen = new Set<string>()
  for (const segment of splitMarkdownImageReferences(source)) {
    if (segment.kind !== 'image') continue
    if (seen.has(segment.ref.src)) continue
    seen.add(segment.ref.src)
    refs.push(segment.ref)
  }
  return refs
}

export function normalizeMessageImageReferences(value: unknown): MessageImageReference[] {
  if (!Array.isArray(value)) return []
  const refs: MessageImageReference[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    if (typeof obj.src !== 'string' || !isRenderableImageSource(obj.src)) continue
    const src = obj.src.trim()
    if (seen.has(src)) continue
    seen.add(src)
    refs.push({
      src,
      alt: typeof obj.alt === 'string' ? obj.alt : undefined,
      label: typeof obj.label === 'string' ? obj.label : imageFilenameFromSource(src),
      mimeType: typeof obj.mimeType === 'string' ? obj.mimeType : undefined,
      source: obj.source === 'markdown' || obj.source === 'path' || obj.source === 'metadata' || obj.source === 'tool'
        ? obj.source
        : 'metadata',
    })
  }
  return refs
}

function splitMarkdownImages(text: string, out: MarkdownImageSegment[]): void {
  let cursor = 0
  while (cursor < text.length) {
    const start = text.indexOf('![', cursor)
    if (start === -1) break
    const parsed = parseMarkdownImage(text, start)
    if (!parsed) {
      cursor = start + 2
      continue
    }
    splitRawImagePaths(text.slice(cursor, start), out)
    out.push({ kind: 'image', ref: parsed.ref })
    cursor = parsed.end
  }
  splitRawImagePaths(text.slice(cursor), out)
}

function parseMarkdownImage(
  text: string,
  start: number,
): { ref: MessageImageReference; end: number } | null {
  const altEnd = text.indexOf('](', start + 2)
  if (altEnd === -1) return null
  const destStart = altEnd + 2
  const destEnd = text.indexOf(')', destStart)
  if (destEnd === -1) return null

  const alt = text.slice(start + 2, altEnd).trim()
  const destination = parseMarkdownDestination(text.slice(destStart, destEnd))
  if (!destination || !isMarkdownImageSource(destination)) return null

  return {
    end: destEnd + 1,
    ref: {
      src: destination,
      alt: alt || undefined,
      label: imageFilenameFromSource(destination),
      source: 'markdown',
    },
  }
}

function isMarkdownImageSource(value: string): boolean {
  return isRenderableImageSource(value)
}

function isRenderableImageSource(value: string): boolean {
  return /^(?:https?:|data:image\/|blob:)/i.test(value.trim()) || isImageReferenceSource(value)
}

function parseMarkdownDestination(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('<')) {
    const end = trimmed.indexOf('>')
    return end > 1 ? trimmed.slice(1, end).trim() : null
  }
  const quotedTitle = trimmed.match(/^(\S+)\s+["'][\s\S]*["']$/)
  return (quotedTitle?.[1] ?? trimmed).trim()
}

function splitRawImagePaths(text: string, out: MarkdownImageSegment[]): void {
  RAW_IMAGE_PATH_RE.lastIndex = 0
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = RAW_IMAGE_PATH_RE.exec(text)) !== null) {
    const raw = match[0]
    const index = match.index
    if (isUrlPartial(text, index, raw)) continue

    const cleaned = trimTrailingPunctuation(raw)
    if (!isImageReferenceSource(cleaned)) continue

    pushMarkdown(out, text.slice(cursor, index))
    out.push({
      kind: 'image',
      ref: {
        src: cleaned,
        label: imageFilenameFromSource(cleaned),
        source: 'path',
      },
    })
    cursor = index + raw.length
  }
  pushMarkdown(out, text.slice(cursor))
}

function isUrlPartial(text: string, index: number, raw: string): boolean {
  if (raw.includes('://')) return true
  return text.slice(Math.max(0, index - 10), index).includes('://')
}

function trimTrailingPunctuation(value: string): string {
  let next = value.trim()
  while (/[.,;:]$/.test(next)) next = next.slice(0, -1)
  while (next.endsWith(')') && !next.includes('(')) next = next.slice(0, -1)
  return next
}

function pushMarkdown(out: MarkdownImageSegment[], text: string): void {
  if (!text) return
  const last = out[out.length - 1]
  if (last?.kind === 'markdown') {
    last.text += text
  } else {
    out.push({ kind: 'markdown', text })
  }
}

function splitCodeRegions(source: string): Array<{ text: string; protected: boolean }> {
  const regions: Array<{ text: string; protected: boolean }> = []
  let cursor = 0
  while (cursor < source.length) {
    const fence = source.indexOf('```', cursor)
    const tick = source.indexOf('`', cursor)
    const next = minPositive(fence, tick)
    if (next === -1) {
      regions.push({ text: source.slice(cursor), protected: false })
      break
    }
    if (next > cursor) regions.push({ text: source.slice(cursor, next), protected: false })
    const marker = source.startsWith('```', next) ? '```' : '`'
    const end = source.indexOf(marker, next + marker.length)
    if (end === -1) {
      regions.push({ text: source.slice(next), protected: true })
      break
    }
    regions.push({ text: source.slice(next, end + marker.length), protected: true })
    cursor = end + marker.length
  }
  return regions
}

function minPositive(a: number, b: number): number {
  if (a === -1) return b
  if (b === -1) return a
  return Math.min(a, b)
}
