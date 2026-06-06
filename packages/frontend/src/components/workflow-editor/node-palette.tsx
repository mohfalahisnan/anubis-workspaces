import { NODE_PALETTE, NODE_CATEGORIES, NODE_CATEGORY_LABELS } from './executable-nodes'

export function NodePalette() {
  return (
    <aside className='w-48 shrink-0 overflow-y-auto border-r border-border bg-sidebar p-3'>
      <p className='mb-3 text-[10px] uppercase tracking-wider text-muted-foreground'>Palette</p>
      <div className='space-y-4'>
        {NODE_CATEGORIES.map((category) => {
          const items = NODE_PALETTE.filter((item) => item.category === category)
          if (items.length === 0) return null
          return (
            <div key={category}>
              <p className='mb-1.5 text-[10px] font-medium uppercase tracking-wider text-primary'>
                {NODE_CATEGORY_LABELS[category]}
              </p>
              <div className='space-y-1.5'>
                {items.map((item) => (
                  <div
                    key={item.type}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData('application/x-anubis-node', item.type); e.dataTransfer.effectAllowed = 'move' }}
                    className='cursor-grab rounded-md border border-border bg-card px-3 py-2 text-xs transition-colors hover:border-primary/40 hover:bg-accent'
                  >
                    {item.label}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
