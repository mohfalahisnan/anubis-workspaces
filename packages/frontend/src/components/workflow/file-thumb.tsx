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

function Skeleton({ className }: { className?: string }) {
  return <div className={`h-20 w-full animate-pulse rounded-lg bg-white/5 ${className ?? ''}`} />
}

export function FileThumb({ path, className = '' }: { path: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    artifactUrl(path).then((u) => { if (!cancelled) setUrl(u) }).catch(() => { if (!cancelled) setUrl(null) })
    return () => { cancelled = true }
  }, [path])

  const ext = extOf(path)
  if (IMAGE_EXT.has(ext)) {
    return url ? (
      <img src={url} alt={basename(path)} className={`h-20 w-full rounded-lg object-cover ${className}`} />
    ) : <Skeleton className={className} />
  }
  if (VIDEO_EXT.has(ext)) {
    return url ? (
      <video src={url} className={`h-20 w-full rounded-lg object-cover ${className}`} muted preload='metadata' />
    ) : <Skeleton className={className} />
  }
  return (
    <div className={`flex h-20 w-full items-center justify-center rounded-lg border border-white/10 bg-white/5 text-[10px] text-zinc-400 ${className}`}>
      <span className='truncate px-2'>{basename(path)}</span>
    </div>
  )
}
