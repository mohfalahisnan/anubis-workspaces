import { memo } from 'react'
import { Bot } from 'lucide-react'
import { NodeShell } from '@/components/workflow'
import { ACCENT_GRADIENTS } from '@/components/workflow/theme'
import { RunStateBadge } from './_run-state-badge'
import { useNodeRunStatus } from './_use-run-status'
import { useNodeRunOutput } from './_use-run-output'
import { FileThumb } from '@/components/workflow/file-thumb'
import { useNavigation } from '@/lib/navigation'
import { nodeTitle, type TitledNodeData } from './_node-title'

export interface AiAgentConversationNodeData extends TitledNodeData {
  profileId?: string
  reasoning?: 'minimal' | 'low' | 'medium' | 'high'
  prompt?: string
  titleTemplate?: string
}

interface AiAgentOutput {
  kind: 'aiAgent'
  conversationId: string
  messageId: string
  text: string
  data?: unknown
  paths?: string[]
}

function ResultSection({ output }: { output: AiAgentOutput }) {
  const { navigate } = useNavigation()
  return (
    <div className='mt-3 space-y-2 rounded-xl border border-border bg-muted/30 p-2'>
      {output.paths && output.paths.length > 0 ? (
        <div className={`grid gap-2 ${output.paths.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {output.paths.slice(0, 4).map((p) => <FileThumb key={p} path={p} />)}
        </div>
      ) : null}
      <p className='line-clamp-4 text-xs leading-relaxed text-muted-foreground'>{output.text || '(no text)'}</p>
      <button
        type='button'
        onClick={() => navigate({ page: 'active-conversation', conversationId: output.conversationId })}
        className='block text-[10px] font-medium text-primary hover:underline'
      >
        Open chat →
      </button>
    </div>
  )
}

export const AiAgentConversationExecutableNode = memo(function AiAgentConversationExecutableNode({
  id, data,
}: { id: string; data: AiAgentConversationNodeData }) {
  const runStatus = useNodeRunStatus(id)
  const output = useNodeRunOutput(id) as AiAgentOutput | undefined
  const promptPreview = (data.prompt ?? '').slice(0, 120) || '<no prompt>'
  return (
    <NodeShell
      icon={Bot}
      title={nodeTitle(data, 'AI Agent · Conversation')}
      subtitle={data.profileId ? `Profile: ${data.profileId} · reasoning: ${data.reasoning ?? 'default'}` : 'Pick a profile in the inspector'}
      accent={ACCENT_GRADIENTS.default}
      runStatus={runStatus}
      footer={<RunStateBadge nodeId={id} />}
    >
      <pre className='text-[10px] text-muted-foreground whitespace-pre-wrap break-words'>{promptPreview}</pre>
      {output?.kind === 'aiAgent' ? <ResultSection output={output} /> : null}
    </NodeShell>
  )
})
