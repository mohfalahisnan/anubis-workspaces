import { memo } from 'react'
import { Image as ImageIcon } from 'lucide-react'
import { NodeShell } from '@/components/workflow'
import { RunStateBadge } from './_run-state-badge'
import { useNodeRunStatus } from './_use-run-status'

export interface TransformerMediaNodeData { url?: string }

export const TransformerMediaExecutableNode = memo(function TransformerMediaExecutableNode({ id, data }: { id: string; data: TransformerMediaNodeData }) {
  const runStatus = useNodeRunStatus(id)
  return (
    <NodeShell
      icon={ImageIcon}
      title='Transformer · Media'
      subtitle={data.url ? `URL: ${data.url}` : 'Pulls upstream media URL'}
      accent='from-[#fd551d] to-[#8b5cf6]'
      runStatus={runStatus}
      footer={<RunStateBadge nodeId={id} />}
    >
      <p className='text-xs text-zinc-300'>Downloads to a run artifact</p>
    </NodeShell>
  )
})
