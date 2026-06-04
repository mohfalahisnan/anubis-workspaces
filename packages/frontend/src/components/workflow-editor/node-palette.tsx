import { NODE_PALETTE } from './executable-nodes'

export function NodePalette() {
  return (
    <aside className='w-48 shrink-0 border-r border-border bg-sidebar p-3'>
      <p className='mb-2 text-[10px] uppercase tracking-wider text-muted-foreground'>Palette</p>
      <div className='space-y-1.5'>
        {NODE_PALETTE.map((item) => (
          <div
            key={item.type}
            draggable
            onDragStart={(e) => { e.dataTransfer.setData('application/x-anubis-node', item.type); e.dataTransfer.effectAllowed = 'move' }}
            className='cursor-grab rounded-md border border-border bg-card px-3 py-2 text-xs hover:border-[#fd551d]/40'
          >
            {item.label}
          </div>
        ))}
      </div>
    </aside>
  )
}
