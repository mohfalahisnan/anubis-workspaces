import { memo } from 'react'
import { Bot } from 'lucide-react'
import { NodeShell, StatusBadge } from '@/components/workflow'
import { RunStateBadge } from './_run-state-badge'
import { useNodeRunStatus } from './_use-run-status'

export interface AiAgentNodeData {
  profileId?: string
  reasoning?: 'low' | 'medium' | 'high'
  prompt?: string
}

export const AiAgentExecutableNode = memo(function AiAgentExecutableNode({ id, data }: { id: string; data: AiAgentNodeData }) {
  const runStatus = useNodeRunStatus(id)
  return (
    <NodeShell
      icon={Bot}
      title='AI Agent'
      subtitle={data.profileId ? `Profile: ${data.profileId}` : 'No profile selected'}
      accent='from-[#fd551d] to-white'
      runStatus={runStatus}
      footer={
        <div className='flex flex-wrap gap-2'>
          <StatusBadge>{data.reasoning ?? 'medium'}</StatusBadge>
          <RunStateBadge nodeId={id} />
        </div>
      }
    >
      <p className='text-xs leading-relaxed text-zinc-300 line-clamp-4'>{data.prompt ?? '<no prompt set>'}</p>
    </NodeShell>
  )
})
