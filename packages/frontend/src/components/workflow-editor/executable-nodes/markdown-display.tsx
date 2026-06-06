import { memo } from 'react'
import { FileText } from 'lucide-react'
import { NodeShell } from '@/components/workflow'
import { ACCENT_GRADIENTS } from '@/components/workflow/theme'
import { MessageResponse } from '@/components/ai-elements/message'
import { useNodeRunStatus } from './_use-run-status'
import { useNodeRunOutput } from './_use-run-output'

export interface MarkdownDisplayNodeData { staticText?: string }

export const MarkdownDisplayExecutableNode = memo(function MarkdownDisplayExecutableNode(
  { id, data }: { id: string; data: MarkdownDisplayNodeData },
) {
  const runStatus = useNodeRunStatus(id)
  const output = useNodeRunOutput(id) as { kind: 'markdown'; text: string } | undefined
  const text = output?.kind === 'markdown' ? output.text : data.staticText ?? ''
  const hasText = text.trim().length > 0
  return (
    <NodeShell
      icon={FileText}
      title='Markdown'
      accent={ACCENT_GRADIENTS.review}
      handles='both'
      runStatus={runStatus}
      chromeless={hasText}
    >
      {hasText ? (
        // Full rendered markdown — fills the card, no max-height scroll.
        <div className='bg-muted/20 p-4 text-xs'>
          <MessageResponse>{text}</MessageResponse>
        </div>
      ) : (
        <p className='text-xs text-muted-foreground'>Connect a node that outputs text.</p>
      )}
    </NodeShell>
  )
})
