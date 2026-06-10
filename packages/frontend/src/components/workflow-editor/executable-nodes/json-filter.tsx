import { memo } from 'react'
import { Filter } from 'lucide-react'
import { NodeShell, StatusBadge } from '@/components/workflow'
import { ACCENT_GRADIENTS } from '@/components/workflow/theme'
import { RunStateBadge } from './_run-state-badge'
import { useNodeRunStatus } from './_use-run-status'
import { useNodeRunOutput } from './_use-run-output'
import { JsonFallback } from './_json-fallback'
import { nodeTitle, type TitledNodeData } from './_node-title'

export interface JsonFilterRule {
  field: string
  operator: string
  value?: unknown
}

export interface JsonFilterNodeData extends TitledNodeData {
  sourcePath?: string
  matchType?: 'all' | 'any'
  rules?: JsonFilterRule[]
}

export const JsonFilterExecutableNode = memo(function JsonFilterExecutableNode(
  { id, data }: { id: string; data: JsonFilterNodeData },
) {
  const runStatus = useNodeRunStatus(id)
  const output = useNodeRunOutput(id) as { kind: 'json'; value: unknown } | undefined
  const source = data.sourcePath?.trim() ? data.sourcePath : 'first upstream JSON'
  const rules = data.rules ?? []
  const matchType = data.matchType ?? 'all'
  const matchLabel = matchType === 'any' ? 'match ANY rule' : 'match ALL rules'

  return (
    <NodeShell
      icon={Filter}
      title={nodeTitle(data, 'JSON Filter')}
      subtitle={`Filter ${source} where rows ${matchLabel}`}
      accent={ACCENT_GRADIENTS.data}
      runStatus={runStatus}
      footer={<div className='flex flex-wrap gap-2'><StatusBadge>json</StatusBadge><RunStateBadge nodeId={id} /></div>}
    >
      {rules.length === 0 ? (
        <p className='text-[10px] text-muted-foreground'>No rules — passes everything through.</p>
      ) : (
        <ul className='space-y-1 text-[10px] text-muted-foreground'>
          {rules.map((rule, i) => (
            <li key={i} className='truncate'>
              <span className='font-mono'>{rule.field || '<field>'}</span>{' '}
              <span className='opacity-70'>{rule.operator}</span>{' '}
              {rule.value !== undefined && rule.value !== '' ? (
                <span className='font-mono'>{String(rule.value)}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {output?.kind === 'json' ? <JsonFallback value={output.value} /> : null}
    </NodeShell>
  )
})
