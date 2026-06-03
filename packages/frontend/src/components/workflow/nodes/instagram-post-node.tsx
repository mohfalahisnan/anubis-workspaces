import { memo } from 'react'

import { NodeShell } from '../node-shell'
import { StatusBadge } from '../status-badge'

export interface InstagramPostNodeData {
  account: string
  caption: string
  imageUrl: string
  metrics: { likes: string }
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      className={className}
      aria-hidden='true'
    >
      <rect x='3' y='3' width='18' height='18' rx='5' />
      <circle cx='12' cy='12' r='4' />
      <circle cx='17.5' cy='6.5' r='0.8' fill='currentColor' stroke='none' />
    </svg>
  )
}

export const InstagramPostNode = memo(function InstagramPostNode({
  data,
}: {
  data: InstagramPostNodeData
}) {
  return (
    <NodeShell
      icon={InstagramIcon}
      title='Competitor Instagram Post'
      subtitle='Raw social content input with caption, media, engagement, and extracted text.'
      accent='from-[#fd551d] via-[#ff6b35] to-[#ff9b7a]'
      footer={
        <div className='flex flex-wrap gap-2'>
          <StatusBadge tone='info'>OCR ready</StatusBadge>
          <StatusBadge tone='info'>Transcript ready</StatusBadge>
          <StatusBadge>{data.metrics.likes} likes</StatusBadge>
        </div>
      }
    >
      <div className='overflow-hidden rounded-xl border border-white/10 bg-black'>
        <img src={data.imageUrl} alt='Competitor post visual' className='h-44 w-full object-cover' />
        <div className='p-3'>
          <div className='flex items-center gap-2'>
            <div className='h-8 w-8 rounded-full bg-gradient-to-tr from-[#fd551d] to-[#ff9b7a]' />
            <div>
              <p className='text-xs font-semibold'>{data.account}</p>
              <p className='text-[10px] text-zinc-500'>Sponsored content · 2h ago</p>
            </div>
          </div>
          <p className='mt-3 line-clamp-4 text-xs leading-relaxed text-zinc-300'>
            <span className='font-semibold text-white'>{data.account}</span> {data.caption}
          </p>
        </div>
      </div>
    </NodeShell>
  )
})
