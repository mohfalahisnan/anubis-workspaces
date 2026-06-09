import { PlusIcon, SearchIcon, Loader2Icon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ModeToggle } from '@/components/mode-toggle'
import { useNavigation } from '@/lib/navigation'
import { useKbLoader } from '@/lib/use-kb-loader'

function KbBackgroundLoaderIndicator() {
  const loading = useKbLoader((s) => s.loading)
  const progressText = useKbLoader((s) => s.progressText)

  if (!loading) return null

  return (
    <div className='hidden items-center gap-2 rounded-full border border-[color-mix(in_oklab,var(--anubis-gold)_30%,var(--border))] bg-card/60 px-3 py-1.5 text-xs text-muted-foreground animate-pulse shadow-sm sm:flex mr-2'>
      <Loader2Icon className='size-3.5 animate-spin text-[var(--anubis-gold)]' />
      <span className='font-mono text-[11px] font-medium tracking-tight text-foreground/80'>{progressText}</span>
    </div>
  )
}

export function TopBar({ breadcrumb }: { breadcrumb?: string }) {
  const { navigate } = useNavigation()

  return (
    <header className='sticky top-0 z-10 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur sm:px-6'>
      {breadcrumb && (
        <div className='hidden items-center gap-2.5 sm:flex'>
          <span className='text-[13px] tracking-[-0.01em] text-muted-foreground'>
            {breadcrumb}
          </span>
        </div>
      )}

      <div className='relative hidden flex-1 sm:block'>
        <SearchIcon className='pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
        <input
          type='search'
          placeholder='Search conversations, profiles, skills…'
          className='h-9 w-full max-w-md rounded-md border border-border bg-muted/40 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:bg-background'
        />
      </div>

      <div className='flex flex-1 items-center justify-end gap-1.5 sm:flex-none'>
        <KbBackgroundLoaderIndicator />
        <Button
          size='sm'
          className='gap-1.5'
          onClick={() => navigate({ page: 'active-conversation' })}
        >
          <PlusIcon className='size-4' />
          <span className='hidden sm:inline'>New conversation</span>
        </Button>
        <ModeToggle />
      </div>
    </header>
  )
}
