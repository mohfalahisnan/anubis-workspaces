import { memo } from 'react'
import { Save } from 'lucide-react'
import { NodeShell } from '@/components/workflow'
import { ACCENT_GRADIENTS } from '@/components/workflow/theme'
import { RunStateBadge } from './_run-state-badge'
import { useNodeRunStatus } from './_use-run-status'
import { useNodeRunOutput } from './_use-run-output'
import { nodeTitle, type TitledNodeData } from './_node-title'

export interface OutputCapturerNodeData extends TitledNodeData {
  outputPath?: string
  filename?: string
  extension?: 'md' | 'json' | 'txt'
}

interface OutputCapturerOutput {
  filePath?: string
  filename?: string
  size?: number
  error?: string
}

export const OutputCapturerExecutableNode = memo(function OutputCapturerExecutableNode(
  { id, data }: { id: string; data: OutputCapturerNodeData },
) {
  const runStatus = useNodeRunStatus(id)
  const output = useNodeRunOutput(id) as OutputCapturerOutput | undefined

  const ext = data.extension ?? 'json'
  const template = data.filename || 'output-{timestamp}'
  const sub = `${template}.${ext}`

  return (
    <NodeShell
      icon={Save}
      title={nodeTitle(data, 'Output Capturer')}
      subtitle={sub}
      accent={ACCENT_GRADIENTS.final}
      runStatus={runStatus}
      footer={<RunStateBadge nodeId={id} />}
    >
      <div className='text-xs space-y-2 text-muted-foreground'>
        <p className='truncate'>
          <span className='font-semibold text-foreground/75'>Path: </span>
          {data.outputPath || '.anubis/captures/'}
        </p>

        {output?.error ? (
          <div className='mt-2 rounded-lg border border-destructive/20 bg-destructive/10 p-2 text-[10px] text-destructive'>
            <p className='font-semibold'>Write failed:</p>
            <p className='break-all'>{output.error}</p>
          </div>
        ) : output?.filePath ? (
          <div className='mt-2 space-y-1 rounded-lg border border-border bg-muted/40 p-2 text-[10px] text-foreground/80'>
            <p className='font-semibold text-emerald-400'>Saved Successfully!</p>
            <p className='truncate' title={output.filePath}>
              <span className='font-medium text-foreground/70'>File: </span>
              {output.filename}
            </p>
            <p>
              <span className='font-medium text-foreground/70'>Size: </span>
              {output.size !== undefined ? `${output.size} bytes` : 'unknown'}
            </p>
          </div>
        ) : (
          <p className='text-[10px] text-muted-foreground'>
            Saves upstream data to a file on disk.
          </p>
        )}
      </div>
    </NodeShell>
  )
})
