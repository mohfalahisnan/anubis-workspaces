import { useEffect, useState } from 'react'

import { getHealth } from '@/api'
import { cn } from '@/lib/utils'
import { Sidebar } from './sidebar'
import { TopBar } from './topbar'
import {
  ActivityPanel,
  AgentsPanel,
  ContentPipeline,
  OutputChart,
  StatCards,
} from './panels'

type BackendState = 'checking' | 'online' | 'offline'

function StatusPill() {
  const [state, setState] = useState<BackendState>('checking')

  useEffect(() => {
    let active = true
    getHealth()
      .then(() => active && setState('online'))
      .catch(() => active && setState('offline'))
    return () => {
      active = false
    }
  }, [])

  const meta: Record<BackendState, { dot: string; label: string }> = {
    checking: { dot: 'bg-muted-foreground/50 animate-pulse', label: 'Connecting' },
    online: { dot: 'bg-emerald-500', label: 'All systems operational' },
    offline: { dot: 'bg-rose-500', label: 'Backend offline' },
  }
  const { dot, label } = meta[state]

  return (
    <span className='inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground'>
      <span className={cn('size-1.5 rounded-full', dot)} />
      {label}
    </span>
  )
}

export function Dashboard() {
  return (
    <div className='flex h-screen w-screen overflow-hidden bg-background text-foreground'>
      <Sidebar />
      <div className='flex min-w-0 flex-1 flex-col'>
        <TopBar />
        <main className='flex-1 overflow-y-auto'>
          <div className='mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6'>
            <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
              <div>
                <h1 className='text-2xl font-semibold tracking-tight'>Good morning, Falah</h1>
                <p className='mt-1 text-sm text-muted-foreground'>
                  Here's what your content agents have been up to.
                </p>
              </div>
              <StatusPill />
            </div>

            <StatCards />

            <div className='grid grid-cols-1 gap-4 lg:grid-cols-3'>
              <div className='flex flex-col gap-4 lg:col-span-2'>
                <OutputChart />
                <ActivityPanel />
              </div>
              <div className='flex flex-col gap-4'>
                <AgentsPanel />
                <ContentPipeline />
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
