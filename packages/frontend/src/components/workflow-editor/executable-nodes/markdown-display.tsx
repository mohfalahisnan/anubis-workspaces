import { memo } from 'react'
import { FileText } from 'lucide-react'
import { NodeShell, StatusBadge } from '@/components/workflow'
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
      accent='from-[#fd551d] to-[#22c55e]'
      handles='in'
      runStatus={runStatus}
      footer={<div className='flex flex-wrap gap-2'><StatusBadge>output</StatusBadge><RunStateBadge nodeId={id} /></div>}
    >
      {text ? (
        <div className='max-h-60 overflow-auto rounded-xl border border-white/10 bg-black/30 p-3 text-xs'>
          <MessageResponse>{text}</MessageResponse>
        </div>
      ) : (
        <p className='text-xs text-zinc-300'>Connect a node that outputs text.</p>
      )}
    </NodeShell>
  )
})
