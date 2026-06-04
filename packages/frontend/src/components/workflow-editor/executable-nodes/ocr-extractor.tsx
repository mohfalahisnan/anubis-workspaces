import { memo } from 'react'
import { Search } from 'lucide-react'
import { NodeShell } from '@/components/workflow'
import { RunStateBadge } from './_run-state-badge'
import { useNodeRunStatus } from './_use-run-status'

export interface OcrExtractorNodeData { imagePath?: string }

export const OcrExtractorExecutableNode = memo(function OcrExtractorExecutableNode({ id, data }: { id: string; data: OcrExtractorNodeData }) {
  const runStatus = useNodeRunStatus(id)
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
    </NodeShell>
  )
})
