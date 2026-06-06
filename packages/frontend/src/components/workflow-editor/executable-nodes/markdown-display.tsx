import { memo } from 'react'
import { FileText } from 'lucide-react'
import { NodeShell, StatusBadge } from '@/components/workflow'
import { ACCENT_GRADIENTS } from '@/components/workflow/theme'
import { MessageResponse } from '@/components/ai-elements/message'
import { RunStateBadge } from './_run-state-badge'
import { useNodeRunStatus } from './_use-run-status'
import { useNodeRunOutput } from './_use-run-output'

export interface MarkdownDisplayNodeData { staticText?: string }

export const MarkdownDisplayExecutableNode = memo(function MarkdownDisplayExecutableNode(
  { id, data }: { id: string; data: MarkdownDisplayNodeData },
) {
  const runStatus = useNodeRunStatus(id)
  const output = useNodeRunOutput(id) as { kind: 'markdown'; text: string } | undefined
  const text = output?.kind === 'markdown' ? output.text : data.staticText ?? ''
  return (
    <NodeShell
      icon={FileText}
      title='Markdown'
      subtitle='Passive — renders upstream text as markdown'
      accent={ACCENT_GRADIENTS.review}
      handles='in'
      runStatus={runStatus}
      footer={<div className='flex flex-wrap gap-2'><StatusBadge>output</StatusBadge><RunStateBadge nodeId={id} /></div>}
    >
      {text ? (
        <div className='max-h-60 overflow-auto rounded-xl border border-border bg-muted/30 p-3 text-xs'>
          <MessageResponse>{text}</MessageResponse>
        </div>
      ) : (
        <p className='text-xs text-muted-foreground'>Connect a node that outputs text.</p>
      )}
    </NodeShell>
  )
})
