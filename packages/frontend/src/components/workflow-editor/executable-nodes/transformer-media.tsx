import { memo } from 'react'
import { Image as ImageIcon } from 'lucide-react'
import { NodeShell } from '@/components/workflow'
import { ACCENT_GRADIENTS } from '@/components/workflow/theme'
import { RunStateBadge } from './_run-state-badge'
import { useNodeRunStatus } from './_use-run-status'
import { useNodeRunOutput } from './_use-run-output'
import { FileThumb } from '@/components/workflow/file-thumb'

interface FileOutput {
  kind: 'file'
  path: string
  mimeType?: string
  sizeBytes?: number
}

export interface TransformerMediaNodeData { url?: string }

export const TransformerMediaExecutableNode = memo(function TransformerMediaExecutableNode({ id, data }: { id: string; data: TransformerMediaNodeData }) {
  const runStatus = useNodeRunStatus(id)
  const output = useNodeRunOutput(id) as FileOutput | undefined
  return (
    <NodeShell
      icon={ImageIcon}
      title='Transformer · Media'
      subtitle={data.url ? `URL: ${data.url}` : 'Pulls upstream media URL'}
      accent={ACCENT_GRADIENTS.media}
      runStatus={runStatus}
      footer={<RunStateBadge nodeId={id} />}
    >
      <p className='text-xs text-muted-foreground'>Downloads to a run artifact</p>
      {output?.kind === 'file' ? (
        <div className='mt-3 rounded-xl border border-border bg-muted/30 p-2'>
          <FileThumb path={output.path} />
          {output.mimeType ? (
            <p className='mt-1 truncate text-[10px] text-muted-foreground'>
              {output.mimeType}{output.sizeBytes ? ` · ${(output.sizeBytes / 1024).toFixed(1)} KB` : ''}
            </p>
          ) : null}
        </div>
      ) : null}
    </NodeShell>
  )
})
