import { memo } from 'react'
import { Sparkles } from 'lucide-react'
import { NodeShell } from '@/components/workflow'
import { ACCENT_GRADIENTS } from '@/components/workflow/theme'
import { RunStateBadge } from './_run-state-badge'
import { useNodeRunStatus } from './_use-run-status'
import { useNodeRunOutput } from './_use-run-output'
import { nodeTitle, type TitledNodeData } from './_node-title'

export interface FlowImageNodeData extends TitledNodeData {
  prompt?: string
  projectUrl?: string
  ratio?: '16:9' | '4:3' | '1:1' | '3:4' | '9:16'
  variations?: 1 | 2 | 3 | 4
  model?: string
  downloadDir?: string
}

export const FlowImageExecutableNode = memo(function FlowImageExecutableNode({ id, data }: { id: string; data: FlowImageNodeData }) {
  const runStatus = useNodeRunStatus(id)
  const output = useNodeRunOutput(id) as
    | { kind: 'json'; value: { resultEditUrls?: string[]; downloadedImagePaths?: string[]; model?: string } }
    | undefined
  const subtitle = data.prompt
    ? `"${data.prompt.slice(0, 40)}${data.prompt.length > 40 ? '…' : ''}" · ${data.model ?? 'Nano Banana Pro'}`
    : `Prompt from upstream · ${data.model ?? 'Nano Banana Pro'}`
  return (
    <NodeShell
      icon={Sparkles}
      title={nodeTitle(data, 'Flow Image')}
      subtitle={subtitle}
      accent={ACCENT_GRADIENTS.media}
      runStatus={runStatus}
      footer={<RunStateBadge nodeId={id} />}
    >
      <p className='text-xs text-muted-foreground'>Generates images in Google Flow (headed Chrome)</p>
      {output?.kind === 'json' && Array.isArray(output.value?.resultEditUrls) ? (
        <div className='mt-3 rounded-xl border border-border bg-muted/30 p-2 text-[10px] text-muted-foreground'>
          {output.value.resultEditUrls.length} result(s)
          {output.value.downloadedImagePaths?.length ? ` · ${output.value.downloadedImagePaths.length} downloaded` : ''}
        </div>
      ) : null}
    </NodeShell>
  )
})
