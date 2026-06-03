import { memo } from 'react'
import { AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react'

import { ACCENT_GRADIENTS } from '../theme'
import { NodeShell } from '../node-shell'
import { StatusBadge } from '../status-badge'

export interface AgentReviewCheck {
  label: string
  description: string
  pass: boolean
}

export interface AgentReviewNodeData {
  checks: AgentReviewCheck[]
}

export const AgentReviewNode = memo(function AgentReviewNode({
  data,
}: {
  data: AgentReviewNodeData
}) {
  return (
    <NodeShell
      icon={ShieldCheck}
      title='Agent Review'
      subtitle='Reviews executor result against brand guideline, source support, originality, and publish readiness.'
      accent={ACCENT_GRADIENTS.review}
      footer={
        <div className='flex flex-wrap gap-2'>
          <StatusBadge tone='success'>Approve path</StatusBadge>
          <StatusBadge tone='warning'>Reject loops back</StatusBadge>
        </div>
      }
    >
      <div className='grid grid-cols-2 gap-2'>
        {data.checks.map((check) => (
          <div key={check.label} className='rounded-xl border border-white/10 bg-white/[0.04] p-3'>
            <div className='flex items-center gap-2'>
              {check.pass ? (
                <CheckCircle2 className='h-4 w-4 text-[#22c55e]' />
              ) : (
                <AlertTriangle className='h-4 w-4 text-[#f59e0b]' />
              )}
              <p className='text-xs font-medium text-white'>{check.label}</p>
            </div>
            <p className='mt-1 text-[10px] text-zinc-500'>{check.description}</p>
          </div>
        ))}
      </div>
    </NodeShell>
  )
})
