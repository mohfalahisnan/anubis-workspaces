import { useEffect, useState } from 'react'

import {
  getHealth,
  listConversations,
  listCronJobs,
  listProfiles,
  listSkills,
} from '@/api'
import { cn } from '@/lib/utils'
import { Sidebar } from './sidebar'
import { TopBar } from './topbar'
import { ActionsGrid, type LiveCounts } from './actions-grid'
import type { Action } from './actions'

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
    online: { dot: 'bg-[var(--anubis-success)]', label: 'Backend ready' },
    offline: { dot: 'bg-destructive', label: 'Backend offline' },
  }
  const { dot, label } = meta[state]

  return (
    <span className='inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground'>
      <span className={cn('size-1.5 rounded-full', dot)} />
      {label}
    </span>
  )
}

function LiveStatusRow({ counts }: { counts: LiveCounts }) {
  const items: { key: keyof LiveCounts; label: string }[] = [
    { key: 'profiles', label: 'profiles' },
    { key: 'conversations', label: 'conversations' },
    { key: 'skills', label: 'skills' },
    { key: 'cron', label: 'scheduled jobs' },
  ]

  return (
    <div className='flex flex-wrap items-center gap-2'>
      {items.map(({ key, label }) => {
        const n = counts[key]
        return (
          <span
            key={key}
            className='inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[12px] text-muted-foreground tabular-nums'
          >
            <span className='font-medium text-foreground'>
              {n === undefined ? '—' : n}
            </span>
            {label}
          </span>
        )
      })}
    </div>
  )
}

function useLiveCounts(): LiveCounts {
  const [counts, setCounts] = useState<LiveCounts>({})

  useEffect(() => {
    let active = true

    async function fetchAll() {
      const [profiles, conversations, skills, cron] = await Promise.allSettled([
        listProfiles(),
        listConversations({ limit: 200 }),
        listSkills(),
        listCronJobs(),
      ])
      if (!active) return
      setCounts({
        profiles: profiles.status === 'fulfilled' ? profiles.value.length : undefined,
        conversations:
          conversations.status === 'fulfilled' ? conversations.value.length : undefined,
        skills: skills.status === 'fulfilled' ? skills.value.length : undefined,
        cron: cron.status === 'fulfilled' ? cron.value.length : undefined,
        // competitors + content are not yet wired to backend endpoints — leave undefined
      })
    }

    void fetchAll()
    return () => {
      active = false
    }
  }, [])

  return counts
}

function handleAction(action: Action) {
  // No router yet — log the intent. Wire to real routes once pages exist.
  console.info('[anubis] action selected:', action.id)
}

export function Dashboard() {
  const counts = useLiveCounts()

  return (
    <div className='flex h-screen w-screen overflow-hidden bg-background text-foreground'>
      <Sidebar />
      <div className='flex min-w-0 flex-1 flex-col'>
        <TopBar />
        <main className='flex-1 overflow-y-auto'>
          <div className='mx-auto flex w-full max-w-6xl flex-col gap-8 p-4 sm:p-6 lg:py-10'>
            <header className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
              <div>
                <h1 className='text-2xl font-semibold tracking-[-0.02em]'>
                  Good morning, Falah
                </h1>
                <p className='mt-1 text-sm text-muted-foreground'>
                  Pick an action to get started.
                </p>
              </div>
              <StatusPill />
            </header>

            <LiveStatusRow counts={counts} />

            <ActionsGrid counts={counts} onActionClick={handleAction} />
          </div>
        </main>
      </div>
    </div>
  )
}
