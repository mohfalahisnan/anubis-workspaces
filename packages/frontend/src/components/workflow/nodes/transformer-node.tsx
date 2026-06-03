import { memo } from 'react'
import { Image as ImageIcon, FileText } from 'lucide-react'

import { ACCENT_GRADIENTS } from '../theme'
import { NodeShell } from '../node-shell'
import { StatusBadge } from '../status-badge'

export interface TransformerBriefItem {
  label: string
  value: string
}

export type TransformerNodeData =
  | {
      kind: 'media'
      title: string
      subtitle: string
      badge: string
      imageUrl: string
      videoUrl: string
      videoPoster: string
    }
  | {
      kind: 'brief'
      title: string
      subtitle: string
      badge: string
      items: TransformerBriefItem[]
    }

export const TransformerNode = memo(function TransformerNode({
  data,
}: {
  data: TransformerNodeData
}) {
  const Icon = data.kind === 'media' ? ImageIcon : FileText

  return (
    <NodeShell
      icon={Icon}
      title={data.title}
      subtitle={data.subtitle}
      accent={data.kind === 'media' ? ACCENT_GRADIENTS.media : ACCENT_GRADIENTS.default}
      footer={<StatusBadge tone='info'>{data.badge}</StatusBadge>}
    >
      {data.kind === 'media' ? (
        <div className='grid grid-cols-2 gap-2'>
          <div className='overflow-hidden rounded-xl border border-white/10 bg-black'>
            <img src={data.imageUrl} alt='Image transform preview' className='h-28 w-full object-cover' />
            <div className='border-t border-white/10 p-2 text-[10px] text-zinc-400'>Image output</div>
          </div>
          <div className='overflow-hidden rounded-xl border border-white/10 bg-black'>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video className='h-28 w-full object-cover' poster={data.videoPoster} muted>
              <source src={data.videoUrl} type='video/mp4' />
            </video>
            <div className='border-t border-white/10 p-2 text-[10px] text-zinc-400'>Video output</div>
          </div>
        </div>
      ) : (
        <div className='space-y-2'>
          {data.items.map((item) => (
            <div key={item.label} className='rounded-xl border border-white/10 bg-white/[0.04] p-3'>
              <p className='text-[10px] uppercase tracking-wider text-zinc-500'>{item.label}</p>
              <p className='mt-1 text-xs leading-relaxed text-zinc-200'>{item.value}</p>
            </div>
          ))}
        </div>
      )}
    </NodeShell>
  )
})
