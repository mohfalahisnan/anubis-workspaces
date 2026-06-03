import { memo } from 'react'
import { Search } from 'lucide-react'

import { ACCENT_GRADIENTS } from '../theme'
import { NodeShell } from '../node-shell'
import { StatusBadge } from '../status-badge'

export interface SearchNodeContext {
  title: string
  score: string
  summary: string
}

export interface SearchNodeData {
  latency: string
  context: SearchNodeContext[]
}

export const SearchNode = memo(function SearchNode({ data }: { data: SearchNodeData }) {
  return (
    <NodeShell
      icon={Search}
      title='Anubis Context Retrieval'
      subtitle='Similarity search and full context pack retrieval from internal knowledge base.'
      accent={ACCENT_GRADIENTS.data}
      footer={
        <div className='flex flex-wrap gap-2'>
          <StatusBadge tone='success'>Similarity engine</StatusBadge>
          <StatusBadge tone='success'>Context pack</StatusBadge>
          <StatusBadge>{data.latency}</StatusBadge>
        </div>
      }
    >
      <div className='space-y-2'>
        {data.context.map((ctx) => (
          <div key={ctx.title} className='rounded-xl bg-white/[0.04] p-3'>
            <div className='flex items-center justify-between gap-3'>
              <p className='truncate text-xs font-medium text-white'>{ctx.title}</p>
              <span className='text-[10px] text-[#ff9b7a]'>{ctx.score}</span>
            </div>
            <p className='mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-400'>{ctx.summary}</p>
          </div>
        ))}
      </div>
    </NodeShell>
  )
})
