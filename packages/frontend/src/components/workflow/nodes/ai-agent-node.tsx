import { memo } from 'react'
import { Bot } from 'lucide-react'

import { NodeShell } from '../node-shell'
import { StatusBadge } from '../status-badge'

export interface AIAgentNodeData {
  mode: string
  steps: string[]
}

export const AIAgentNode = memo(function AIAgentNode({ data }: { data: AIAgentNodeData }) {
  return (
    <NodeShell
      icon={Bot}
      title='AI Agent Executor'
      subtitle='Executes the approved content workflow and prepares the final publishing package.'
      accent='from-[#fd551d] to-white'
      footer={
        <div className='flex flex-wrap gap-2'>
          <StatusBadge tone='success'>Executor ready</StatusBadge>
          <StatusBadge tone='info'>Tools scoped</StatusBadge>
          <StatusBadge>{data.mode}</StatusBadge>
        </div>
      }
    >
      <div className='space-y-2'>
        {data.steps.map((step) => (
          <div
            key={step}
            className='rounded-xl border border-white/10 bg-white/[0.04] p-3 text-xs leading-relaxed text-zinc-300'
          >
            {step}
          </div>
        ))}
      </div>
    </NodeShell>
  )
})
