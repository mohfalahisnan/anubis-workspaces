import type { ComponentType, ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { motion } from 'motion/react'

import { ACCENT_GRADIENTS } from './theme'
import { NodeDirectionalHandles, type HandleVariant } from './handles'

export type NodeRunStatus = 'pending' | 'running' | 'awaiting' | 'succeeded' | 'failed' | 'skipped'

export interface NodeShellProps {
  icon: ComponentType<{ className?: string }>
  title: string
  subtitle?: string
  /** Tailwind gradient classes — prefer the `ACCENT_GRADIENTS` presets. */
  accent?: string
  footer?: ReactNode
  children?: ReactNode
  className?: string
  /** Skip the framer-motion entry animation. */
  disableMotion?: boolean
  /** Run lifecycle status — drives the glow ring around the node. */
  runStatus?: NodeRunStatus
  /** Which connection handles to render. Defaults to both. */
  handles?: HandleVariant
  /** Custom handle nodes — when set, replaces the default directional handles. */
  handlesNode?: ReactNode
  /**
   * Render `children` edge-to-edge below the header — no body padding, no
   * footer. Used by the Media node so the artifact fills the whole card.
   */
  bleed?: boolean
}

const SHELL_BASE =
  'relative w-[360px] overflow-visible rounded-2xl border bg-card/95 backdrop-blur-xl ' +
  'text-card-foreground shadow-2xl shadow-black/20 transition-shadow duration-300'

const RUN_STATUS_BORDER: Record<NodeRunStatus, string> = {
  pending:   'border-border',
  running:   'border-primary shadow-[0_0_26px_3px_rgba(217,164,65,0.5)] animate-[nodeRunGlow_1.6s_ease-in-out_infinite]',
  awaiting:  'border-anubis-gold-hi shadow-[0_0_30px_4px_rgba(217,164,65,0.7)] animate-[nodeRunGlow_1.6s_ease-in-out_infinite]',
  succeeded: 'border-anubis-success shadow-[0_0_22px_2px_rgba(95,185,122,0.42)]',
  failed:    'border-destructive shadow-[0_0_26px_3px_rgba(224,122,111,0.5)]',
  skipped:   'border-muted-foreground/40',
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
  handles = 'both',
  handlesNode,
  bleed = false,
}: NodeShellProps) {
  const runClass = runStatus ? RUN_STATUS_BORDER[runStatus] : 'border-border'

  const header = (
    <div className='flex items-start gap-3'>
      <div className='rounded-xl border border-primary/20 bg-primary/10 p-2 text-primary'>
        <Icon className='h-5 w-5' />
      </div>
      <div className='min-w-0 flex-1'>
        <h3 className='text-sm font-semibold tracking-tight text-foreground'>{title}</h3>
        {subtitle ? (
          <p className='mt-0.5 text-xs leading-relaxed text-muted-foreground'>{subtitle}</p>
        ) : null}
      </div>
    </div>
  )

  const inner = (
    <div className={cn(SHELL_BASE, runClass, className)}>
      {handlesNode ?? <NodeDirectionalHandles variant={handles} />}
      <div className='overflow-hidden rounded-2xl'>
        <div className={cn('h-1 bg-gradient-to-r', accent)} />
        {bleed ? (
          <>
            <div className='px-4 pt-4'>{header}</div>
            {children ? <div className='mt-3'>{children}</div> : <div className='pb-4' />}
          </>
        ) : (
          <div className='p-4'>
            {header}
            {children ? <div className='mt-4'>{children}</div> : null}
            {footer ? <div className='mt-4 border-t border-border pt-3'>{footer}</div> : null}
          </div>
        )}
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
