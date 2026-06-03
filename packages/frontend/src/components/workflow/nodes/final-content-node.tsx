import { memo } from 'react'
import { Sparkles } from 'lucide-react'

import { ACCENT_GRADIENTS } from '../theme'
import { NodeShell } from '../node-shell'
import { StatusBadge } from '../status-badge'

export interface FinalContentNodeData {
  title: string
  caption: string
  format: string
  channel: string
  status: string
}

export const FinalContentNode = memo(function FinalContentNode({
  data,
}: {
  data: FinalContentNodeData
}) {
  return (
    <NodeShell
      icon={Sparkles}
      title='Ready-to-Post Content'
      subtitle='Approved final content package prepared for publishing.'
      accent={ACCENT_GRADIENTS.final}
      footer={
        <div className='flex flex-wrap gap-2'>
          <StatusBadge tone='success'>Approved</StatusBadge>
          <StatusBadge tone='success'>Ready to schedule</StatusBadge>
          <StatusBadge>{data.channel}</StatusBadge>
        </div>
      }
    >
      <div className='overflow-hidden rounded-xl border border-white/10 bg-white/[0.04]'>
        <div className='border-b border-white/10 p-3'>
          <p className='text-xs font-semibold text-white'>{data.title}</p>
          <p className='mt-1 text-xs leading-relaxed text-zinc-400'>{data.caption}</p>
        </div>
        <div className='grid grid-cols-3 divide-x divide-white/10 text-center text-[10px] text-zinc-400'>
          <div className='p-3'><b className='block text-white'>{data.format}</b>Format</div>
          <div className='p-3'><b className='block text-white'>{data.channel}</b>Channel</div>
          <div className='p-3'><b className='block text-white'>{data.status}</b>Status</div>
        </div>
      </div>
    </NodeShell>
  )
})
