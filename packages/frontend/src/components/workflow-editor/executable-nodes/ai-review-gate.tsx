import { memo } from 'react'
import { ShieldCheck } from 'lucide-react'
import { NodeShell } from '@/components/workflow'
import { ApprovalHandles } from '@/components/workflow/handles'
import { ACCENT_GRADIENTS } from '@/components/workflow/theme'
import { useNodeRunStatus } from './_use-run-status'
import { nodeTitle, type TitledNodeData } from './_node-title'

export interface AiReviewGateNodeData extends TitledNodeData {
  prompt?: string
  maxIterations?: number
}

export const AiReviewGateExecutableNode = memo(function AiReviewGateExecutableNode(
  { id, data }: { id: string; data: AiReviewGateNodeData },
) {
  const status = useNodeRunStatus(id)
  return (
    <NodeShell
      icon={ShieldCheck}
      title={nodeTitle(data, 'AI Review')}
      subtitle='An agent reviews the content and branches approve / reject.'
      accent={ACCENT_GRADIENTS.review}
      runStatus={status}
      handlesNode={<ApprovalHandles />}
    >
      <p className='text-xs text-muted-foreground'>
        Auto-reviews upstream content; reject loops back up to {data.maxIterations ?? 3}×.
      </p>
    </NodeShell>
  )
})
