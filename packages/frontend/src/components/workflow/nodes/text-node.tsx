import { memo } from 'react'
import { FileText } from 'lucide-react'

import { ACCENT_GRADIENTS } from '../theme'
import { NodeShell } from '../node-shell'
import { StatusBadge } from '../status-badge'

export interface TextNodeData {
  title: string
  subtitle: string
  badge: string
  body: string
}

export const TextNode = memo(function TextNode({ data }: { data: TextNodeData }) {
  return (
    <NodeShell
      icon={FileText}
      title={data.title}
      subtitle={data.subtitle}
      accent={ACCENT_GRADIENTS.default}
      footer={<StatusBadge>{data.badge}</StatusBadge>}
    >
      <div className='rounded-xl bg-white/[0.04] p-3 text-xs leading-relaxed text-zinc-300'>
        {data.body}
      </div>
    </NodeShell>
  )
})
