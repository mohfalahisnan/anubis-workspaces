import { SparklesIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { navItems } from './data'

export function Sidebar() {
  return (
    <aside className='hidden w-60 shrink-0 flex-col border-r border-border bg-card/40 lg:flex'>
      <div className='flex h-16 items-center gap-2.5 px-5'>
        <div className='flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground'>
          <SparklesIcon className='size-4' />
        </div>
        <div className='leading-tight'>
          <div className='text-sm font-semibold tracking-tight'>Content OS</div>
          <div className='text-[11px] text-muted-foreground'>AI Agent workspace</div>
        </div>
      </div>

      <nav className='flex flex-1 flex-col gap-0.5 px-3 py-4'>
        <div className='px-2 pb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground'>
          Workspace
        </div>
        {navItems.map((item) => (
          <a
            key={item.label}
            href='#'
            aria-current={item.active ? 'page' : undefined}
            className={cn(
              'group flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
              item.active
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <item.icon className='size-4 shrink-0' />
            <span className='flex-1'>{item.label}</span>
            {item.badge && (
              <Badge variant='secondary' className='h-5 px-1.5 text-[11px]'>
                {item.badge}
              </Badge>
            )}
          </a>
        ))}
      </nav>

      <div className='m-3 rounded-xl border border-border bg-muted/40 p-4'>
        <div className='text-sm font-medium'>Free plan</div>
        <p className='mt-1 text-xs text-muted-foreground'>
          642 / 1,000 content credits used this month.
        </p>
        <div className='mt-3 h-1.5 w-full overflow-hidden rounded-full bg-border'>
          <div className='h-full rounded-full bg-primary' style={{ width: '64%' }} />
        </div>
      </div>
    </aside>
  )
}
