import { memo } from 'react'
import { Brain } from 'lucide-react'

import { ACCENT_GRADIENTS } from '../theme'
import { NodeShell } from '../node-shell'
import { StatusBadge } from '../status-badge'

export interface ContextBuilderBriefItem {
  label: string
  source: string
  value: string
}

export interface ContextBuilderNodeData {
  brief: ContextBuilderBriefItem[]
}

export const ContextBuilderNode = memo(function ContextBuilderNode({
  data,
}: {
  data: ContextBuilderNodeData
}) {
  return (
    <NodeShell
      icon={Brain}
      title='AI Context Builder'
      subtitle='Builds the execution brief from crawler output, transformed data, brand rules, knowledge base, and similarity context.'
      accent={ACCENT_GRADIENTS.data}
      footer={
        <div className='flex flex-wrap gap-2'>
          <StatusBadge tone='success'>Brief generated</StatusBadge>
          <StatusBadge tone='info'>Context packed</StatusBadge>
        </div>
      }
    >
      <div className='space-y-2'>
        {data.brief.map((item) => (
          <div key={item.label} className='rounded-xl border border-white/10 bg-white/[0.04] p-3'>
            <div className='flex items-center justify-between gap-3'>
              <p className='text-xs font-semibold text-white'>{item.label}</p>
              <span className='text-[10px] text-[#ff9b7a]'>{item.source}</span>
            </div>
            <p className='mt-1 text-xs leading-relaxed text-zinc-400'>{item.value}</p>
          </div>
        ))}
      </div>
    </NodeShell>
  )
})
