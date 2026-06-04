import { memo } from 'react'
import { Search } from 'lucide-react'
import { NodeShell } from '@/components/workflow'
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
      accent='from-[#fd551d] to-[#3b82f6]'
      runStatus={runStatus}
      footer={<RunStateBadge nodeId={id} />}
    >
      <p className='text-xs text-zinc-300'>Extracts text via anubis-extractor</p>
      {output?.kind === 'text' ? (
        <div className='mt-3 max-h-[160px] overflow-auto rounded-xl border border-white/10 bg-black/30 p-2'>
          <pre className='whitespace-pre-wrap break-words text-[10px] text-zinc-300'>{output.text || '(empty)'}</pre>
        </div>
      ) : null}
    </NodeShell>
  )
})
