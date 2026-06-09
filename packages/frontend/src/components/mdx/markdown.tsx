import { memo } from 'react'
import { Streamdown } from 'streamdown'
import { cn } from '@/lib/utils'
import { splitMarkdownImageReferences } from '@/lib/message-image-detection'
import { useMdxConversation } from './conversation-context'
import { MessageImageList } from './message-image'

interface MdxMarkdownProps {
  source: string
  className?: string
}

/**
 * Thin wrapper around Streamdown. Streamdown bundles rehype-harden and
 * rehype-sanitize with safe defaults; <script>, on* handlers, and
 * javascript: URLs are stripped automatically. We pass mode="streaming"
 * so partial fences and tags don't tear during chunked rendering.
 */
export const MdxMarkdown = memo(function MdxMarkdown({ source, className }: MdxMarkdownProps) {
  const { conversationId } = useMdxConversation()
  const segments = splitMarkdownImageReferences(source)
  const hasImages = segments.some((segment) => segment.kind === 'image')

  return (
    <div className={cn('mdx-markdown text-[15.5px] leading-[1.68] text-foreground', className)}>
      {hasImages ? (
        <div className='flex flex-col gap-2'>
          {segments.map((segment, index) => {
            if (segment.kind === 'image') {
              return (
                <MessageImageList
                  key={`${segment.ref.src}:${index}`}
                  refs={[segment.ref]}
                  conversationId={conversationId}
                />
              )
            }
            if (!segment.text.trim()) return null
            return <StreamdownContent key={index} source={segment.text} />
          })}
        </div>
      ) : (
        <StreamdownContent source={source} />
      )}
    </div>
  )
})

function StreamdownContent({ source }: { source: string }) {
  return (
    <Streamdown
      mode='streaming'
      parseIncompleteMarkdown
      // Line numbers are noise in short chat code blocks and the gutter
      // crops content inside the 720px conversation column. Turn them off.
      lineNumbers={false}
    >
      {source}
    </Streamdown>
  )
}
