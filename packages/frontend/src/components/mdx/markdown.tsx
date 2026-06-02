import { memo } from 'react'
import { Streamdown } from 'streamdown'
import { cn } from '@/lib/utils'

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
  return (
    <div className={cn('mdx-markdown text-[15.5px] leading-[1.68] text-foreground', className)}>
      <Streamdown mode='streaming' parseIncompleteMarkdown>
        {source}
      </Streamdown>
    </div>
  )
})
