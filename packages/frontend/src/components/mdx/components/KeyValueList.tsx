export interface KeyValueListProps {
  items: Record<string, string | number | boolean | null>
}

export function KeyValueList({ items }: KeyValueListProps) {
  const entries = Object.entries(items)
  if (entries.length === 0) return null
  return (
    <dl className='my-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md border border-border bg-card px-3 py-2.5 text-[13px]'>
      {entries.map(([k, v]) => (
        <div key={k} className='contents'>
          <dt className='font-mono text-[11.5px] uppercase tracking-[0.06em] text-muted-foreground'>
            {k}
          </dt>
          <dd className='m-0 font-mono tabular-nums text-foreground'>
            {v === null ? '—' : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  )
}
