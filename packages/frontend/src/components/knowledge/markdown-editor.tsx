import { cn } from '@/lib/utils'

export function MarkdownEditor({
  value, onChange, className,
}: {
  value: string
  onChange: (v: string) => void
  className?: string
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
      className={cn(
        'h-full w-full resize-none rounded-md border border-border bg-background p-3 font-mono text-[12.5px] leading-relaxed text-foreground outline-none focus:border-[color-mix(in_oklab,var(--anubis-gold)_50%,var(--border))]',
        className,
      )}
    />
  )
}
