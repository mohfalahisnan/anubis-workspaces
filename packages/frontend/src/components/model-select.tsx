import { useState } from 'react'
import type { ModelInfo } from '@/api'

const CUSTOM = '__custom__'

interface ModelSelectProps {
  id?: string
  models: ModelInfo[]
  value: string
  onChange: (model: string) => void
  selectClassName?: string
  inputClassName?: string
}

/**
 * Model picker backed by the ai-agent catalog, with a free-text escape
 * hatch: the backend passes the model id to the agent CLI as-is, so any
 * id the CLI accepts works even before it lands in the catalog.
 */
export function ModelSelect({
  id,
  models,
  value,
  onChange,
  selectClassName,
  inputClassName,
}: ModelSelectProps) {
  const known = models.some((m) => m.id === value)
  const [forcedCustom, setForcedCustom] = useState(false)
  const custom = forcedCustom || !known

  return (
    <div className='flex flex-col gap-2'>
      <select
        id={id}
        value={custom ? CUSTOM : value}
        onChange={(e) => {
          if (e.target.value === CUSTOM) {
            setForcedCustom(true)
          } else {
            setForcedCustom(false)
            onChange(e.target.value)
          }
        }}
        className={selectClassName}
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {(m.displayName ?? m.id)}{m.description ? ` — ${m.description}` : ''}
          </option>
        ))}
        <option value={CUSTOM}>Custom model id…</option>
      </select>
      {custom && (
        <input
          type='text'
          aria-label='Custom model id'
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder='e.g. claude-fable-5 — sent to the agent CLI as-is'
          className={inputClassName}
        />
      )}
    </div>
  )
}
