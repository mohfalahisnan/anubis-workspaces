import { memo } from 'react'
import { Bot } from 'lucide-react'
import { NodeShell } from '@/components/workflow'
import { RunStateBadge } from './_run-state-badge'
import { useNodeRunStatus } from './_use-run-status'

export interface AiAgentConversationNodeData {
  profileId?: string
  reasoning?: 'minimal' | 'low' | 'medium' | 'high'
  prompt?: string
  titleTemplate?: string
}

export const AiAgentConversationExecutableNode = memo(function AiAgentConversationExecutableNode({
  id, data,
}: { id: string; data: AiAgentConversationNodeData }) {
  const runStatus = useNodeRunStatus(id)
  const promptPreview = (data.prompt ?? '').slice(0, 120) || '<no prompt>'
  return (
    <NodeShell
      icon={Bot}
      title='AI Agent · Conversation'
      subtitle={data.profileId ? `Profile: ${data.profileId} · reasoning: ${data.reasoning ?? 'default'}` : 'Pick a profile in the inspector'}
      accent='from-[#fd551d] to-[#ff9b7a]'
      runStatus={runStatus}
      footer={<RunStateBadge nodeId={id} />}
    >
      <pre className='text-[10px] text-zinc-300 whitespace-pre-wrap break-words'>{promptPreview}</pre>
    </NodeShell>
  )
})
