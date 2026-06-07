import { memo } from 'react'
import { FileText } from 'lucide-react'
import { NodeShell } from '@/components/workflow'
import { ACCENT_GRADIENTS } from '@/components/workflow/theme'
import { RunStateBadge } from './_run-state-badge'
import { useNodeRunStatus } from './_use-run-status'
import { useNodeRunOutput } from './_use-run-output'
import { JsonFallback } from './_json-fallback'
import { nodeTitle, type TitledNodeData } from './_node-title'

export interface TransformerBriefNodeData extends TitledNodeData { jsonTemplate?: string }

export const TransformerBriefExecutableNode = memo(function TransformerBriefExecutableNode({ id, data }: { id: string; data: TransformerBriefNodeData }) {
  const runStatus = useNodeRunStatus(id)
  const output = useNodeRunOutput(id) as { kind: 'json'; value: unknown } | undefined
  return (
    <NodeShell
      icon={FileText}
      title={nodeTitle(data, 'Transformer · Brief')}
      subtitle='Renders JSON template with {{paths}}'
      accent={ACCENT_GRADIENTS.data}
      runStatus={runStatus}
      footer={<RunStateBadge nodeId={id} />}
    >
      <pre className='text-[10px] text-muted-foreground whitespace-pre-wrap break-words'>{data.jsonTemplate ?? '<empty template>'}</pre>
      {output?.kind === 'json' ? <JsonFallback value={output.value} /> : null}
    </NodeShell>
  )
})
