import { memo } from 'react'
import { Table as TableIcon } from 'lucide-react'

import { ACCENT_GRADIENTS } from '../theme'
import { NodeShell } from '../node-shell'
import { StatusBadge } from '../status-badge'

export interface TableNodeRow {
  source: string
  type: string
  score: string
}

export interface TableNodeData {
  rows: TableNodeRow[]
}

export const TableNode = memo(function TableNode({ data }: { data: TableNodeData }) {
  return (
    <NodeShell
      icon={TableIcon}
      title='Reference Table'
      subtitle='Internal and external references rendered as structured source rows.'
      accent={ACCENT_GRADIENTS.review}
      footer={<StatusBadge tone='success'>{data.rows.length} references matched</StatusBadge>}
    >
      <div className='overflow-hidden rounded-xl border border-white/10'>
        <table className='w-full text-left text-xs'>
          <thead className='bg-white/[0.06] text-[10px] uppercase tracking-wider text-zinc-400'>
            <tr>
              <th className='px-3 py-2'>Source</th>
              <th className='px-3 py-2'>Type</th>
              <th className='px-3 py-2'>Score</th>
            </tr>
          </thead>
          <tbody className='divide-y divide-white/10'>
            {data.rows.map((row) => (
              <tr key={row.source} className='bg-zinc-950/40'>
                <td className='px-3 py-2 text-zinc-200'>{row.source}</td>
                <td className='px-3 py-2 text-zinc-400'>{row.type}</td>
                <td className='px-3 py-2 font-medium text-[#ff9b7a]'>{row.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </NodeShell>
  )
})
