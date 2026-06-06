import { useEffect, useState } from 'react'
import { artifactUrl } from '@/lib/artifacts'

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'])
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov'])

function extOf(path: string): string {
  const m = path.match(/\.([a-z0-9]{1,5})(?:[?#]|$)/i)
  return m && m[1] ? m[1].toLowerCase() : ''
}

function basename(path: string): string {
  const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return lastSlash >= 0 ? path.slice(lastSlash + 1) : path
}

function Skeleton({ className, fill }: { className?: string; fill?: boolean }) {
  return (
    <div
      className={`w-full animate-pulse bg-muted ${fill ? 'aspect-square' : 'h-20 rounded-lg'} ${className ?? ''}`}
    />
  )
}

/**
 * Renders an artifact path as an image / video thumbnail.
 *
 * `fill` mode shows the media at its natural aspect, full width, with no
 * cropping, rounding, or chrome — used by the Media output node so the
 * artifact reads as just the media itself.
 */
export function FileThumb({ path, className = '', fill = false }: { path: string; className?: string; fill?: boolean }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    artifactUrl(path).then((u) => { if (!cancelled) setUrl(u) }).catch(() => { if (!cancelled) setUrl(null) })
    return () => { cancelled = true }
  }, [path])

  const mediaClass = fill
    ? `block h-auto w-full object-contain ${className}`
    : `h-20 w-full rounded-lg object-cover ${className}`

  const ext = extOf(path)
  if (IMAGE_EXT.has(ext)) {
    return url ? (
      <img src={url} alt={basename(path)} className={mediaClass} />
    ) : <Skeleton className={className} fill={fill} />
  }
  if (VIDEO_EXT.has(ext)) {
    return url ? (
      <video src={url} className={mediaClass} controls={fill} muted preload='metadata' />
    ) : <Skeleton className={className} fill={fill} />
  }
  return (
    <div className={`flex h-20 w-full items-center justify-center rounded-lg border border-border bg-muted text-[10px] text-muted-foreground ${className}`}>
      <span className='truncate px-2'>{basename(path)}</span>
    </div>
  )
}
