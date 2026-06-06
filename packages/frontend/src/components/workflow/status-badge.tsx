import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export type StatusBadgeTone = 'default' | 'success' | 'warning' | 'info'

const TONE_CLASS: Record<StatusBadgeTone, string> = {
  default: 'border-border bg-muted text-muted-foreground',
  success: 'border-anubis-success/30 bg-anubis-success/10 text-anubis-success',
  warning: 'border-[#f59e0b]/30 bg-[#f59e0b]/10 text-[#d99412]',
  info:    'border-primary/30 bg-primary/10 text-primary',
}

export interface StatusBadgeProps {
  children: ReactNode
  tone?: StatusBadgeTone
  className?: string
}

export function StatusBadge({ children, tone = 'default', className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium',
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
