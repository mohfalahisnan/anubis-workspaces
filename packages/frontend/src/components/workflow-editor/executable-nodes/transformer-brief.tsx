import { memo } from 'react'
import { FileText } from 'lucide-react'
import { NodeShell } from '@/components/workflow'
import { RunStateBadge } from './_run-state-badge'
import { useNodeRunStatus } from './_use-run-status'

export interface TransformerBriefNodeData { jsonTemplate?: string }

export const TransformerBriefExecutableNode = memo(function TransformerBriefExecutableNode({ id, data }: { id: string; data: TransformerBriefNodeData }) {
  const runStatus = useNodeRunStatus(id)
  return (
    <NodeShell
      icon={FileText}
      title='Transformer · Brief'
      subtitle='Renders JSON template with {{paths}}'
      accent='from-[#fd551d] to-[#ff9b7a]'
      runStatus={runStatus}
      footer={<RunStateBadge nodeId={id} />}
    >
      <pre className='text-[10px] text-zinc-300 whitespace-pre-wrap break-words'>{data.jsonTemplate ?? '<empty template>'}</pre>
    </NodeShell>
  )
})
