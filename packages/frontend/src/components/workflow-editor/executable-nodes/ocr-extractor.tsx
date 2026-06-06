import { memo } from 'react'
import { Search } from 'lucide-react'
import { NodeShell } from '@/components/workflow'
import { ACCENT_GRADIENTS } from '@/components/workflow/theme'
import { RunStateBadge } from './_run-state-badge'
import { useNodeRunStatus } from './_use-run-status'
import { useNodeRunOutput } from './_use-run-output'

export interface OcrExtractorNodeData { imagePath?: string }

export const OcrExtractorExecutableNode = memo(function OcrExtractorExecutableNode({ id, data }: { id: string; data: OcrExtractorNodeData }) {
  const runStatus = useNodeRunStatus(id)
  const output = useNodeRunOutput(id) as { kind: 'text'; text: string } | undefined
  return (
    <NodeShell
      icon={Search}
      title='OCR Extractor'
      subtitle={data.imagePath ?? 'Falls back to upstream file path'}
      accent={ACCENT_GRADIENTS.data}
      runStatus={runStatus}
      footer={<RunStateBadge nodeId={id} />}
    >
      <p className='text-xs text-muted-foreground'>Extracts text via anubis-extractor</p>
      {output?.kind === 'text' ? (
        <div className='mt-3 max-h-[160px] overflow-auto rounded-xl border border-border bg-muted/30 p-2'>
          <pre className='whitespace-pre-wrap break-words text-[10px] text-muted-foreground'>{output.text || '(empty)'}</pre>
        </div>
      ) : null}
    </NodeShell>
  )
})
