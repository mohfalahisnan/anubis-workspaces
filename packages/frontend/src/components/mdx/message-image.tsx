import { useEffect, useMemo, useState } from 'react'
import { XIcon } from 'lucide-react'
import type { MessageImageReference } from '@anubis/shared'
import { imageFilenameFromSource } from '@anubis/shared'
import { conversationFileUrl } from '@/lib/artifacts'
import { cn } from '@/lib/utils'

interface MessageImageListProps {
  refs: MessageImageReference[]
  conversationId: string
  className?: string
}

export function MessageImageList({ refs, conversationId, className }: MessageImageListProps) {
  const uniqueRefs = useMemo(() => {
    const seen = new Set<string>()
    return refs.filter((ref) => {
      const src = ref.src.trim()
      if (!src || seen.has(src)) return false
      seen.add(src)
      return true
    })
  }, [refs])

  if (uniqueRefs.length === 0) return null

  return (
    <div className={cn('flex max-w-full flex-col gap-2', className)}>
      {uniqueRefs.map((ref) => (
        <MessageImage key={ref.src} refData={ref} conversationId={conversationId} />
      ))}
    </div>
  )
}

function MessageImage({
  refData,
  conversationId,
}: {
  refData: MessageImageReference
  conversationId: string
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const label = refData.label || imageFilenameFromSource(refData.src)
  const alt = refData.alt || label

  useEffect(() => {
    let cancelled = false
    setSrc(null)
    setFailed(false)
    if (isBrowserImageUrl(refData.src)) {
      setSrc(refData.src)
      return
    }
    if (!conversationId) {
      setFailed(true)
      return
    }
    conversationFileUrl(conversationId, refData.src)
      .then((url) => {
        if (!cancelled) setSrc(url)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [conversationId, refData.src])

  const fallback = (
    <div className='flex min-h-[92px] w-full items-center justify-center rounded-md border border-dashed border-border bg-muted/35 px-3 py-4 text-center text-[12px] text-muted-foreground'>
      {failed ? `Could not load image: ${alt}` : 'Loading image...'}
    </div>
  )

  return (
    <>
      <figure className='max-w-full overflow-hidden rounded-md border border-border bg-card'>
        <button
          type='button'
          disabled={!src || failed}
          onClick={() => setExpanded(true)}
          className='block w-full bg-muted/20 text-left disabled:cursor-default'
          aria-label={`Expand ${label}`}
        >
          {src && !failed ? (
            <img
              src={src}
              alt={alt}
              onError={() => setFailed(true)}
              className='h-auto max-h-[520px] w-full max-w-full object-contain'
              loading='lazy'
            />
          ) : fallback}
        </button>
        <figcaption className='border-t border-border px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground'>
          <span className='block truncate' title={refData.src}>{label}</span>
        </figcaption>
      </figure>

      {expanded && src && !failed && (
        <div
          className='fixed inset-0 z-50 flex items-center justify-center bg-black/82 p-5'
          role='dialog'
          aria-modal='true'
          aria-label={label}
          onClick={() => setExpanded(false)}
        >
          <button
            type='button'
            className='absolute right-4 top-4 flex size-9 items-center justify-center rounded-md border border-white/15 bg-black/35 text-white transition-colors hover:bg-white/15'
            aria-label='Close image preview'
            onClick={(e) => {
              e.stopPropagation()
              setExpanded(false)
            }}
          >
            <XIcon className='size-4' strokeWidth={2} />
          </button>
          <div className='flex max-h-full max-w-full flex-col gap-2' onClick={(e) => e.stopPropagation()}>
            <img src={src} alt={alt} className='max-h-[86vh] max-w-[92vw] rounded-md object-contain' />
            <div className='max-w-[92vw] truncate text-center font-mono text-[12px] text-white/78'>
              {label}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function isBrowserImageUrl(src: string): boolean {
  return /^(?:https?:|data:image\/|blob:)/i.test(src.trim())
}
