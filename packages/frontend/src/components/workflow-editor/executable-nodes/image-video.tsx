import { memo } from 'react'
import { Image as ImageIcon } from 'lucide-react'
import { NodeShell, StatusBadge } from '@/components/workflow'
import { RunStateBadge } from './_run-state-badge'
import { useNodeRunStatus } from './_use-run-status'

export interface ImageVideoNodeData {
  source?: 'url' | 'local'
  url?: string
  path?: string
}

export const ImageVideoExecutableNode = memo(function ImageVideoExecutableNode({ id, data }: { id: string; data: ImageVideoNodeData }) {
  const runStatus = useNodeRunStatus(id)
  const subtitle =
    data.source === 'local'
      ? data.path ?? 'No local path set'
      : data.source === 'url'
        ? data.url ?? 'No URL set'
        : 'No source selected'
  return (
    <NodeShell
      icon={ImageIcon}
      title='Image / Video'
      subtitle={subtitle}
      accent='from-[#fd551d] to-[#8b5cf6]'
      runStatus={runStatus}
      footer={
        <div className='flex flex-wrap gap-2'>
          <StatusBadge tone='info'>{data.source ?? 'unset'}</StatusBadge>
          <RunStateBadge nodeId={id} />
        </div>
      }
    >
      <p className='text-xs text-zinc-300'>
        {data.source === 'local'
          ? 'Uses an existing local file as-is (no download).'
          : 'Downloads to a run artifact and outputs the file path.'}
      </p>
    </NodeShell>
  )
})
