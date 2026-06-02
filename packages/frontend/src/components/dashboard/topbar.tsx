import { BellIcon, PlusIcon, SearchIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ModeToggle } from '@/components/mode-toggle'

export function TopBar() {
  return (
    <header className='sticky top-0 z-10 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur sm:px-6'>
      <div className='relative hidden flex-1 sm:block'>
        <SearchIcon className='pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
        <input
          type='search'
          placeholder='Search agents, content, pipelines…'
          className='h-9 w-full max-w-md rounded-lg border border-border bg-muted/40 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:bg-background'
        />
      </div>

      <div className='flex flex-1 items-center justify-end gap-1.5 sm:flex-none'>
        <Button size='sm' className='gap-1.5'>
          <PlusIcon className='size-4' />
          <span className='hidden sm:inline'>New content</span>
        </Button>
        <Button variant='ghost' size='icon' aria-label='Notifications' className='relative'>
          <BellIcon className='size-4' />
          <span className='absolute right-2 top-2 size-1.5 rounded-full bg-primary' />
        </Button>
        <ModeToggle />
        <div className='ml-1 flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-primary to-chart-3 text-xs font-semibold text-primary-foreground'>
          FI
        </div>
      </div>
    </header>
  )
}
