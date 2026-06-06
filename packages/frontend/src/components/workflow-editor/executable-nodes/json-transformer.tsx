import { memo } from 'react'
import { Braces } from 'lucide-react'
import { NodeShell, StatusBadge } from '@/components/workflow'
import { ACCENT_GRADIENTS } from '@/components/workflow/theme'
import { RunStateBadge } from './_run-state-badge'
import { useNodeRunStatus } from './_use-run-status'
import { useNodeRunOutput } from './_use-run-output'
import { JsonFallback } from './_json-fallback'

export interface JsonTransformerNodeData {
  sourcePath?: string
  template?: string
}

export const JsonTransformerExecutableNode = memo(function JsonTransformerExecutableNode(
  { id, data }: { id: string; data: JsonTransformerNodeData },
) {
  const runStatus = useNodeRunStatus(id)
  const output = useNodeRunOutput(id) as { kind: 'json'; value: unknown } | undefined
  const source = data.sourcePath?.trim() ? data.sourcePath : 'first upstream JSON'

  return (
    <NodeShell
      icon={Braces}
      title='JSON Transformer'
      subtitle={`Reshape ${source} with a JSON template`}
      accent={ACCENT_GRADIENTS.data}
      runStatus={runStatus}
      footer={<div className='flex flex-wrap gap-2'><StatusBadge>json</StatusBadge><RunStateBadge nodeId={id} /></div>}
    >
      <pre className='max-h-[120px] overflow-auto whitespace-pre-wrap break-words text-[10px] text-muted-foreground'>
        {data.template ?? '<empty template>'}
      </pre>
      {output?.kind === 'json' ? <JsonFallback value={output.value} /> : null}
    </NodeShell>
  )
})
