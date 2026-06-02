import { ArrowUpRightIcon, TrendingDownIcon, TrendingUpIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  activity,
  agents,
  output7d,
  pipeline,
  stats,
  type AgentStatus,
} from './data'

export function StatCards() {
  return (
    <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4'>
      {stats.map((stat) => {
        const positive = stat.delta >= 0
        return (
          <Card key={stat.label} size='sm'>
            <CardContent className='flex flex-col gap-3'>
              <div className='flex items-center justify-between'>
                <span className='text-sm text-muted-foreground'>{stat.label}</span>
                <stat.icon className='size-4 text-muted-foreground' />
              </div>
              <div className='flex items-end justify-between gap-2'>
                <span className='text-2xl font-semibold tracking-tight'>{stat.value}</span>
                <span
                  className={cn(
                    'flex items-center gap-0.5 text-xs font-medium',
                    positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
                  )}
                >
                  {positive ? (
                    <TrendingUpIcon className='size-3.5' />
                  ) : (
                    <TrendingDownIcon className='size-3.5' />
                  )}
                  {positive ? '+' : ''}
                  {stat.delta}%
                </span>
              </div>
              <span className='text-xs text-muted-foreground'>{stat.hint}</span>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

export function OutputChart() {
  const peak = Math.max(...output7d.map((d) => d.value))
  return (
    <Card>
      <CardHeader className='flex-row items-center justify-between'>
        <div>
          <CardTitle>Content output</CardTitle>
          <p className='mt-1 text-sm text-muted-foreground'>Generated assets, last 7 days</p>
        </div>
        <span className='text-xs font-medium text-muted-foreground'>406 total</span>
      </CardHeader>
      <CardContent>
        <div className='flex h-44 items-end gap-2 sm:gap-3'>
          {output7d.map((d) => (
            <div key={d.day} className='flex flex-1 flex-col items-center gap-2'>
              <div className='flex w-full flex-1 items-end'>
                <div
                  className='w-full rounded-t-md bg-primary/15 transition-all hover:bg-primary/30'
                  style={{ height: `${(d.value / peak) * 100}%` }}
                >
                  <div className='h-1 w-full rounded-t-md bg-primary' />
                </div>
              </div>
              <span className='text-[11px] text-muted-foreground'>{d.day}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export function ContentPipeline() {
  const toneClass: Record<string, string> = {
    muted: 'bg-muted-foreground/40',
    accent: 'bg-primary',
    positive: 'bg-emerald-500',
  }
  const total = pipeline.reduce((sum, s) => sum + s.count, 0)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Content pipeline</CardTitle>
        <p className='mt-1 text-sm text-muted-foreground'>{total} items in flight</p>
      </CardHeader>
      <CardContent className='flex flex-col gap-3'>
        {pipeline.map((stage) => (
          <div key={stage.label} className='flex items-center gap-3'>
            <span className={cn('size-1.5 rounded-full', toneClass[stage.tone])} />
            <span className='flex-1 text-sm'>{stage.label}</span>
            <span className='text-sm font-medium tabular-nums'>{stage.count}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

const statusStyles: Record<AgentStatus, { dot: string; label: string }> = {
  active: { dot: 'bg-emerald-500', label: 'Active' },
  idle: { dot: 'bg-muted-foreground/50', label: 'Idle' },
  paused: { dot: 'bg-amber-500', label: 'Paused' },
  error: { dot: 'bg-rose-500', label: 'Error' },
}

export function AgentsPanel() {
  return (
    <Card>
      <CardHeader className='flex-row items-center justify-between'>
        <CardTitle>Agents</CardTitle>
        <a href='#' className='inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline'>
          Manage
          <ArrowUpRightIcon className='size-3.5' />
        </a>
      </CardHeader>
      <CardContent className='flex flex-col gap-1'>
        {agents.map((agent) => {
          const status = statusStyles[agent.status]
          return (
            <div
              key={agent.name}
              className='flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60'
            >
              <div className='flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground'>
                <agent.icon className='size-4' />
              </div>
              <div className='min-w-0 flex-1'>
                <div className='truncate text-sm font-medium'>{agent.name}</div>
                <div className='truncate text-xs text-muted-foreground'>{agent.role}</div>
              </div>
              <div className='flex items-center gap-1.5'>
                <span className={cn('size-1.5 rounded-full', status.dot)} />
                <span className='text-xs text-muted-foreground'>{status.label}</span>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

export function ActivityPanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className='relative flex flex-col gap-5 before:absolute before:left-[3px] before:top-1.5 before:h-[calc(100%-12px)] before:w-px before:bg-border'>
          {activity.map((item, i) => (
            <li key={i} className='relative flex gap-3 pl-5'>
              <span className='absolute left-0 top-1.5 size-1.5 rounded-full bg-primary ring-4 ring-background' />
              <p className='text-sm leading-snug text-muted-foreground'>
                <span className='font-medium text-foreground'>{item.agent}</span> {item.action}{' '}
                <span className='font-medium text-foreground'>{item.target}</span>
                <span className='mt-0.5 block text-xs text-muted-foreground/70'>{item.time}</span>
              </p>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}
