import type { ComponentType, ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { motion } from 'motion/react'

import { ACCENT_GRADIENTS } from './theme'
import { NodeDirectionalHandles } from './handles'

export type NodeRunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'

export interface NodeShellProps {
  icon: ComponentType<{ className?: string }>
  title: string
  subtitle?: string
  /** Tailwind gradient classes (e.g. "from-[#fd551d] to-[#ff9b7a]"). */
  accent?: string
  footer?: ReactNode
  children?: ReactNode
  className?: string
  /** Skip the framer-motion entry animation. */
  disableMotion?: boolean
  /** Run lifecycle status — drives the glow ring around the node. */
  runStatus?: NodeRunStatus
}

const SHELL_BASE =
  'relative w-[360px] overflow-visible rounded-2xl border bg-[#0b0b0c]/90 backdrop-blur-xl ' +
  'text-white shadow-2xl shadow-black/35 transition-shadow duration-300'

const RUN_STATUS_BORDER: Record<NodeRunStatus, string> = {
  pending:   'border-[#fd551d]/20',
  running:   'border-[#fd551d] shadow-[0_0_28px_4px_rgba(253,85,29,0.55)] animate-pulse',
  succeeded: 'border-[#22c55e] shadow-[0_0_24px_2px_rgba(34,197,94,0.45)]',
  failed:    'border-[#ef4444] shadow-[0_0_28px_4px_rgba(239,68,68,0.55)]',
  skipped:   'border-[#a1a1aa]/40',
}

export function NodeShell({
  icon: Icon,
  title,
  subtitle,
  accent = ACCENT_GRADIENTS.default,
  footer,
  children,
  className,
  disableMotion = false,
  runStatus,
}: NodeShellProps) {
  const runClass = runStatus ? RUN_STATUS_BORDER[runStatus] : 'border-[#fd551d]/20'

  const inner = (
    <div className={cn(SHELL_BASE, runClass, className)}>
      <NodeDirectionalHandles />
      <div className='overflow-hidden rounded-2xl'>
        <div className={cn('h-1 bg-gradient-to-r', accent)} />
        <div className='p-4'>
          <div className='flex items-start gap-3'>
            <div className='rounded-xl border border-[#fd551d]/20 bg-[#fd551d]/10 p-2 text-[#fd551d]'>
              <Icon className='h-5 w-5' />
            </div>
            <div className='min-w-0 flex-1'>
              <h3 className='text-sm font-semibold tracking-tight text-white'>{title}</h3>
              {subtitle ? (
                <p className='mt-0.5 text-xs leading-relaxed text-zinc-400'>{subtitle}</p>
              ) : null}
            </div>
          </div>
          {children ? <div className='mt-4'>{children}</div> : null}
          {footer ? <div className='mt-4 border-t border-white/10 pt-3'>{footer}</div> : null}
        </div>
      </div>
    </div>
  )

  if (disableMotion) return inner

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      {inner}
    </motion.div>
  )
}
