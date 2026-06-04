import { memo } from 'react'
import { Image as ImageIcon } from 'lucide-react'
import { NodeShell } from '@/components/workflow'
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
      accent='from-[#fd551d] to-[#8b5cf6]'
      runStatus={runStatus}
      footer={<RunStateBadge nodeId={id} />}
    >
      <p className='text-xs text-zinc-300'>Downloads to a run artifact</p>
      {output?.kind === 'file' ? (
        <div className='mt-3 rounded-xl border border-white/10 bg-black/30 p-2'>
          <FileThumb path={output.path} />
          {output.mimeType ? (
            <p className='mt-1 truncate text-[10px] text-zinc-500'>
              {output.mimeType}{output.sizeBytes ? ` · ${(output.sizeBytes / 1024).toFixed(1)} KB` : ''}
            </p>
          ) : null}
        </div>
      ) : null}
    </NodeShell>
  )
})
