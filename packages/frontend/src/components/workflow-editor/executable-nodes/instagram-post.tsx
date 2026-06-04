import { memo } from 'react'
import { NodeShell, StatusBadge } from '@/components/workflow'
import { RunStateBadge } from './_run-state-badge'
import { useNodeRunStatus } from './_use-run-status'

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' className={className}>
      <rect x='3' y='3' width='18' height='18' rx='5' />
      <circle cx='12' cy='12' r='4' />
      <circle cx='17.5' cy='6.5' r='0.8' fill='currentColor' stroke='none' />
    </svg>
  )
}

export interface InstagramPostNodeData {
  source?: 'existing' | 'url'
  postId?: string
  url?: string
}

export const InstagramPostExecutableNode = memo(function InstagramPostExecutableNode({ id, data }: { id: string; data: InstagramPostNodeData }) {
  const runStatus = useNodeRunStatus(id)
  return (
    <NodeShell
      icon={InstagramIcon}
      title='Instagram Post'
      subtitle={data.source === 'url' ? data.url ?? 'No URL' : data.postId ? `Captured: ${data.postId}` : 'No source selected'}
      accent='from-[#fd551d] via-[#ff6b35] to-[#ff9b7a]'
      runStatus={runStatus}
      footer={
        <div className='flex flex-wrap gap-2'>
          <StatusBadge tone='info'>{data.source ?? 'unset'}</StatusBadge>
          <RunStateBadge nodeId={id} />
        </div>
      }
    >
      <p className='text-xs text-zinc-300'>{data.source === 'url' ? 'Captures via research-crawler' : 'Reads from captured_posts table'}</p>
    </NodeShell>
  )
})
