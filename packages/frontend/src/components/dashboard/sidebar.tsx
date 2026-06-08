import { cn } from '@/lib/utils'
import { AnubisMark } from '@/components/brand/anubis-mark'
import { Badge } from '@/components/ui/badge'
import { useNavigation, type Route } from '@/lib/navigation'
import { navItems, type NavItem } from './data'
import { ProjectSelector } from './project-selector'

export function Sidebar() {
  const { route, navigate } = useNavigation()

  return (
    <aside className='hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex'>
      <button
        type='button'
        onClick={() => navigate({ page: 'home' })}
        className='flex h-16 items-center gap-2.5 px-5 text-left transition-colors hover:bg-sidebar-accent'
      >
        <AnubisMark size={28} />
        <div className='leading-tight'>
          <div className='text-[15px] font-semibold tracking-[-0.02em]'>Anubis</div>
          <div className='text-[11px] text-muted-foreground'>
            Your AI agent content OS
          </div>
        </div>
      </button>

      <nav className='flex flex-1 flex-col gap-0.5 px-3 py-4'>
        <ProjectSelector />
        {navItems.map((item) => {
          const active = route.page === item.page
          return (
            <button
              key={item.label}
              type='button'
              onClick={() => navigate(itemRoute(item))}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'group flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              )}
            >
              {active && (
                <span
                  aria-hidden
                  className='-ml-2.5 mr-0.5 h-4 w-[2px] rounded-r-full bg-[var(--anubis-gold)]'
                />
              )}
              <item.icon className='size-4 shrink-0' strokeWidth={1.5} />
              <span className='flex-1 text-left'>{item.label}</span>
              {item.badge && (
                <Badge variant='secondary' className='h-5 px-1.5 text-[11px]'>
                  {item.badge}
                </Badge>
              )}
            </button>
          )
        })}
      </nav>

      <div className='m-3 rounded-md border border-border bg-card p-4'>
        <div className='text-sm font-medium'>Free plan</div>
        <p className='mt-1 text-xs text-muted-foreground'>
          642 / 1,000 content credits used this month.
        </p>
        <div className='mt-3 h-1.5 w-full overflow-hidden rounded-full bg-border'>
          <div className='h-full rounded-full bg-[var(--anubis-gold)]' style={{ width: '64%' }} />
        </div>
      </div>
    </aside>
  )
}

function itemRoute(item: NavItem): Route {
  switch (item.page) {
    case 'home':
      return { page: 'home' }
    case 'conversations':
      return { page: 'conversations' }
    case 'content':
      return { page: 'content' }
    case 'planner':
      return { page: 'planner' }
    case 'tasks':
      return { page: 'tasks' }
    case 'profiles':
      return { page: 'profiles' }
    case 'skills':
      return { page: 'skills' }
    case 'competitors':
      return { page: 'competitors' }
    case 'scheduled':
      return { page: 'scheduled' }
    case 'workflow-demo':
      return { page: 'workflow-demo' }
    case 'workflows':
      return { page: 'workflows' }
    case 'crawler-playground':
      return { page: 'crawler-playground' }
    case 'settings':
      return { page: 'settings' }
    default:
      return { page: 'home' }
  }
}
