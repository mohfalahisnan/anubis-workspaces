export interface DataTableProps {
  columns: string[]
  rows: Array<Array<string | number | boolean | null>>
}

export function DataTable({ columns, rows }: DataTableProps) {
  if (!Array.isArray(rows) || rows.length === 0) return null
  return (
    <div className='my-3 overflow-x-auto rounded-md border border-border bg-card'>
      <table className='w-full border-collapse text-[13px]'>
        <thead>
          <tr className='border-b border-border bg-muted/50'>
            {columns.map((c) => (
              <th
                key={c}
                className='px-3 py-2 text-left font-mono text-[11.5px] font-medium tracking-[-0.005em] text-muted-foreground'
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className='border-b border-border last:border-b-0'>
              {row.map((cell, ci) => (
                <td key={ci} className='px-3 py-2 font-mono tabular-nums text-foreground'>
                  {cell === null ? '—' : String(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
