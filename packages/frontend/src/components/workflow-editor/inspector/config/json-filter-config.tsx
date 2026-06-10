import { useEditorStore } from '../../editor-store'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Trash2 } from 'lucide-react'

type Rule = { field: string; operator: string; value?: unknown }
type Data = { sourcePath?: string; matchType?: 'all' | 'any'; rules?: Rule[] }

const OPERATORS: Array<{ value: string; label: string }> = [
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'not equals' },
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: 'not contains' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with', label: 'ends with' },
  { value: 'greater_than', label: 'greater than' },
  { value: 'greater_than_or_equal', label: 'greater than or equal' },
  { value: 'less_than', label: 'less than' },
  { value: 'less_than_or_equal', label: 'less than or equal' },
  { value: 'exists', label: 'exists' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'regex', label: 'matches regex' },
]

/** Operators that ignore the value field. */
const VALUELESS = new Set(['exists', 'is_empty'])

export function JsonFilterConfigForm({ nodeId }: { nodeId: string }) {
  const draft = useEditorStore((s) => s.draft)
  const setNodes = useEditorStore((s) => s.setNodes)
  const pushHistory = useEditorStore((s) => s.pushHistory)
  const node = draft.nodes.find((n) => n.id === nodeId)
  const data = (node?.data ?? {}) as Data
  const rules = data.rules ?? []

  function update(patch: Partial<Data>) {
    if (!node) return
    pushHistory()
    setNodes(draft.nodes.map((n) => n.id === nodeId ? { ...n, data: { ...data, ...patch } } : n))
  }

  function updateRule(index: number, patch: Partial<Rule>) {
    update({ rules: rules.map((r, i) => i === index ? { ...r, ...patch } : r) })
  }

  function addRule() {
    update({ rules: [...rules, { field: '', operator: 'equals', value: '' }] })
  }

  function removeRule(index: number) {
    update({ rules: rules.filter((_, i) => i !== index) })
  }

  return (
    <div className='space-y-3'>
      <p className='text-xs uppercase tracking-wider text-muted-foreground'>JSON Filter</p>

      <label className='block text-xs'>Source path
        <Input
          className='mt-1'
          value={data.sourcePath ?? ''}
          onChange={(e) => update({ sourcePath: e.target.value })}
          placeholder='source.value.items'
        />
      </label>

      <label className='block text-xs'>Match
        <Select value={data.matchType ?? 'all'} onValueChange={(v) => update({ matchType: v as Data['matchType'] })}>
          <SelectTrigger className='mt-1'><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>ALL rules (AND)</SelectItem>
            <SelectItem value='any'>ANY rule (OR)</SelectItem>
          </SelectContent>
        </Select>
      </label>

      <div className='space-y-2'>
        <div className='flex items-center justify-between'>
          <span className='text-xs text-muted-foreground'>Rules</span>
          <Button type='button' variant='outline' size='xs' onClick={addRule}>
            <Plus /> Add rule
          </Button>
        </div>

        {rules.length === 0 ? (
          <p className='text-[10px] text-muted-foreground'>No rules yet. The filter passes everything through.</p>
        ) : null}

        {rules.map((rule, index) => {
          const valueless = VALUELESS.has(rule.operator)
          return (
            <div key={index} className='space-y-2 rounded-lg border border-border p-2'>
              <div className='flex items-center gap-2'>
                <Input
                  className='flex-1'
                  value={rule.field}
                  onChange={(e) => updateRule(index, { field: e.target.value })}
                  placeholder='field.path'
                />
                <Button type='button' variant='ghost' size='icon-sm' onClick={() => removeRule(index)} aria-label='Remove rule'>
                  <Trash2 />
                </Button>
              </div>
              <Select value={rule.operator} onValueChange={(v) => updateRule(index, { operator: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {OPERATORS.map((op) => (
                    <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!valueless ? (
                <Input
                  value={rule.value === undefined ? '' : String(rule.value)}
                  onChange={(e) => updateRule(index, { value: e.target.value })}
                  placeholder='value'
                />
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
