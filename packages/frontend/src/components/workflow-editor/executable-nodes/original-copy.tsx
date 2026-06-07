import { memo } from 'react'
import { Quote } from 'lucide-react'
import { NodeShell } from '@/components/workflow'
import { ACCENT_GRADIENTS } from '@/components/workflow/theme'
import { useNodeRunStatus } from './_use-run-status'
import { useNodeRunOutput } from './_use-run-output'
import { nodeTitle, type TitledNodeData } from './_node-title'

export interface OriginalCopyNodeData extends TitledNodeData { staticText?: string }

export const OriginalCopyExecutableNode = memo(function OriginalCopyExecutableNode(
  { id, data }: { id: string; data: OriginalCopyNodeData },
) {
  const runStatus = useNodeRunStatus(id)
  const output = useNodeRunOutput(id) as { kind: 'originalCopy'; text: string } | undefined
  const text = output?.kind === 'originalCopy' ? output.text : data.staticText ?? ''
  const hasText = text.trim().length > 0
  return (
    <NodeShell
      icon={Quote}
      title={nodeTitle(data, 'Original Copy')}
      subtitle='The source copywriting from the content'
      accent={ACCENT_GRADIENTS.data}
      handles='both'
      runStatus={runStatus}
      bleed={hasText}
    >
      {hasText ? (
        // Pure copy viewer — the original caption, verbatim. Plain text with
        // preserved line breaks/emojis (not markdown-collapsed).
        <div className='whitespace-pre-wrap break-words bg-muted/20 p-4 text-xs leading-relaxed text-foreground'>
          {text}
        </div>
      ) : (
        <p className='text-xs text-muted-foreground'>Connect a content source to show its original copy.</p>
      )}
    </NodeShell>
  )
})
