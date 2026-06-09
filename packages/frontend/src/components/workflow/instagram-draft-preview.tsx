import { useEffect, useMemo, useState } from 'react'
import {
  Bookmark,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Play,
  Send,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export interface InstagramDraftPreviewOutput {
  kind: 'instagramDraftPreview'
  caption: string
  mediaUrl: string
  username: string
  avatarUrl?: string
  likesCount?: number
  commentsCount?: number
  format: 'post' | 'reels'
}

const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'm4v'])
const HANDLE_RE = /([#@][A-Za-z0-9_.]+)/g

function extOf(path: string): string {
  const match = path.match(/\.([a-z0-9]{1,5})(?:[?#]|$)/i)
  return match?.[1]?.toLowerCase() ?? ''
}

function isDirectUrl(value: string): boolean {
  return /^(https?:|data:|blob:)/i.test(value)
}

function isVideoUrl(value: string): boolean {
  return VIDEO_EXT.has(extOf(value))
}

function compactNumber(value: number | undefined): string {
  if (value === undefined) return '0'
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function useDisplayUrl(raw: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    if (!raw) {
      setUrl(null)
      return
    }
    if (isDirectUrl(raw)) {
      setUrl(raw)
      return
    }
    import('@/lib/artifacts')
      .then(({ artifactUrl }) => artifactUrl(raw))
      .then((next) => { if (!cancelled) setUrl(next) })
      .catch(() => { if (!cancelled) setUrl(null) })
    return () => { cancelled = true }
  }, [raw])
  return url
}

function Avatar({ username, avatarUrl, dark = false }: { username: string; avatarUrl?: string; dark?: boolean }) {
  const url = useDisplayUrl(avatarUrl)
  const initial = username.trim().charAt(0).toUpperCase() || 'A'
  return (
    <div className={cn(
      'grid size-8 shrink-0 place-items-center overflow-hidden rounded-full border text-[11px] font-semibold',
      dark ? 'border-white/40 bg-white/10 text-white' : 'border-zinc-200 bg-zinc-100 text-zinc-700',
    )}>
      {url ? <img src={url} alt={`${username} avatar`} className='h-full w-full object-cover' /> : initial}
    </div>
  )
}

function Media({ mediaUrl, rounded = false }: { mediaUrl: string; rounded?: boolean }) {
  const url = useDisplayUrl(mediaUrl)
  const video = isVideoUrl(mediaUrl)
  return (
    <div className={cn('relative h-full w-full overflow-hidden bg-zinc-200', rounded && 'rounded-[2px]')}>
      {url && video ? (
        <video src={url} className='h-full w-full object-cover' muted playsInline preload='metadata' />
      ) : url ? (
        <img src={url} alt='Instagram draft media' className='h-full w-full object-cover' />
      ) : (
        <div className='grid h-full w-full place-items-center bg-zinc-200 text-[11px] text-zinc-500'>Media</div>
      )}
      {video ? (
        <div className='absolute inset-0 grid place-items-center'>
          <div className='grid size-14 place-items-center rounded-full bg-black/45 text-white shadow-lg backdrop-blur-sm'>
            <Play className='ml-0.5 size-7 fill-current' />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Caption({ username, caption, dark = false }: { username: string; caption: string; dark?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const shouldCollapse = caption.length > 120
  const tokens = useMemo(() => caption.split(HANDLE_RE).filter(Boolean), [caption])
  const clampStyle = expanded ? undefined : {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical' as const,
    WebkitLineClamp: 3,
    overflow: 'hidden',
  }

  return (
    <div className={cn('text-[12px] leading-[1.35]', dark ? 'text-white' : 'text-zinc-950')}>
      {!dark ? <span className='mr-1 font-semibold'>{username}</span> : null}
      <span style={clampStyle}>
        {tokens.map((part, index) => (
          (part.startsWith('#') || part.startsWith('@'))
            ? <span key={`${part}-${index}`} className='font-medium text-[#0a66c2]'>{part}</span>
            : <span key={`${part}-${index}`}>{part}</span>
        ))}
      </span>
      {shouldCollapse ? (
        <button
          type='button'
          className={cn('ml-1 align-baseline text-[12px]', dark ? 'text-white/70' : 'text-zinc-500')}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'less' : '... more'}
        </button>
      ) : null}
    </div>
  )
}

function PostChrome({ preview }: { preview: InstagramDraftPreviewOutput }) {
  return (
    <article className='w-full overflow-hidden rounded-[3px] border border-zinc-200 bg-white text-zinc-950 shadow-sm'>
      <header className='flex h-12 items-center gap-2.5 px-3'>
        <Avatar username={preview.username} avatarUrl={preview.avatarUrl} />
        <span className='min-w-0 flex-1 truncate text-[13px] font-semibold'>{preview.username}</span>
        <MoreHorizontal className='size-5 text-zinc-900' />
      </header>
      <div className='aspect-[4/5] w-full bg-zinc-100'>
        <Media mediaUrl={preview.mediaUrl} />
      </div>
      <footer className='space-y-2.5 px-3 py-3'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-3'>
            <Heart className='size-6' strokeWidth={2.1} />
            <MessageCircle className='size-6' strokeWidth={2.1} />
            <Send className='size-6' strokeWidth={2.1} />
          </div>
          <Bookmark className='size-6' strokeWidth={2.1} />
        </div>
        <p className='text-[12px] font-semibold'>{compactNumber(preview.likesCount)} likes</p>
        <Caption username={preview.username} caption={preview.caption} />
        <p className='text-[11px] text-zinc-500'>View all {compactNumber(preview.commentsCount)} comments</p>
      </footer>
    </article>
  )
}

function ReelsChrome({ preview }: { preview: InstagramDraftPreviewOutput }) {
  return (
    <article className='relative aspect-[9/16] w-full overflow-hidden rounded-[6px] bg-black text-white shadow-sm'>
      <Media mediaUrl={preview.mediaUrl} />
      <div className='absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/88 via-black/35 to-transparent' />
      <div className='absolute bottom-5 left-4 right-[76px] space-y-2'>
        <div className='flex min-w-0 items-center gap-2'>
          <Avatar username={preview.username} avatarUrl={preview.avatarUrl} dark />
          <span className='truncate text-[13px] font-semibold'>@{preview.username}</span>
        </div>
        <Caption username={preview.username} caption={preview.caption} dark />
      </div>
      <div className='absolute bottom-5 right-4 flex flex-col items-center gap-5 text-white'>
        <div className='grid justify-items-center gap-1'>
          <Heart className='size-7 drop-shadow' strokeWidth={2.1} />
          <span className='text-[11px] font-semibold'>{compactNumber(preview.likesCount)}</span>
        </div>
        <div className='grid justify-items-center gap-1'>
          <MessageCircle className='size-7 drop-shadow' strokeWidth={2.1} />
          <span className='text-[11px] font-semibold'>{compactNumber(preview.commentsCount)}</span>
        </div>
        <Send className='size-7 drop-shadow' strokeWidth={2.1} />
        <MoreHorizontal className='size-7 drop-shadow' strokeWidth={2.1} />
      </div>
    </article>
  )
}

export function InstagramDraftPreview({ preview, className }: { preview: InstagramDraftPreviewOutput; className?: string }) {
  return (
    <div className={cn('w-full bg-[#f5f5f5] p-3', preview.format === 'reels' && 'bg-[#111113]', className)}>
      {preview.format === 'reels' ? <ReelsChrome preview={preview} /> : <PostChrome preview={preview} />}
    </div>
  )
}
