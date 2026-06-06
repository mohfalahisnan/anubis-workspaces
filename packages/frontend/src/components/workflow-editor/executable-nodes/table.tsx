import { memo } from 'react'
import { Table as TableIcon } from 'lucide-react'
import { NodeShell, StatusBadge } from '@/components/workflow'
import { ACCENT_GRADIENTS } from '@/components/workflow/theme'
import { RunStateBadge } from './_run-state-badge'
import { useNodeRunStatus } from './_use-run-status'
import { useNodeRunOutput } from './_use-run-output'

export interface TableNodeData { staticData?: Array<Record<string, unknown>> }

function previewCell(value: unknown): string {
  if (value == null) return '—'
  if (typeof value === 'string') return value.length > 40 ? `${value.slice(0, 40)}…` : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value).slice(0, 40)
}

export const TableExecutableNode = memo(function TableExecutableNode({ id, data }: { id: string; data: TableNodeData }) {
  const count = data.staticData?.length ?? 0
  const runStatus = useNodeRunStatus(id)
  const output = useNodeRunOutput(id) as { kind: 'table'; rows: Array<Record<string, unknown>> } | undefined
  return (
    <NodeShell
      icon={TableIcon}
      title='Table'
      subtitle='Passive — displays input or static rows'
      accent={ACCENT_GRADIENTS.review}
      runStatus={runStatus}
      footer={
        <div className='flex flex-wrap gap-2'>
          <StatusBadge>{count} static rows</StatusBadge>
          <RunStateBadge nodeId={id} />
        </div>
      }
    >
      <p className='text-xs text-muted-foreground'>Whatever flows in shows up here.</p>
      {output?.kind === 'table' && output.rows.length > 0 ? (() => {
        const cols = Object.keys(output.rows[0] ?? {}).slice(0, 4)
        return (
          <div className='mt-3 overflow-hidden rounded-xl border border-border'>
            <table className='w-full text-left text-[10px]'>
              <thead className='bg-muted uppercase tracking-wider text-muted-foreground'>
                <tr>{cols.map((c) => <th key={c} className='px-2 py-1'>{c}</th>)}</tr>
              </thead>
              <tbody className='divide-y divide-border'>
                {output.rows.slice(0, 3).map((row, i) => (
                  <tr key={i}>{cols.map((c) => <td key={c} className='px-2 py-1 text-foreground/80'>{previewCell((row as Record<string, unknown>)[c])}</td>)}</tr>
                ))}
              </tbody>
            </table>
            {output.rows.length > 3 ? <p className='border-t border-border bg-muted/50 px-2 py-1 text-[9px] text-muted-foreground'>+ {output.rows.length - 3} more rows</p> : null}
          </div>
        )
      })() : null}
    </NodeShell>
  )
})
