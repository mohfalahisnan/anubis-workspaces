import { useEffect, useMemo, useState } from 'react'
import {
  BookOpenIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  FolderIcon,
  RefreshCwIcon,
} from 'lucide-react'

import type { SkillDetail, SkillSource, SkillSummary } from '@anubis/shared'

import { getSkill, listSkills, reloadSkills } from '@/api'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/* -----------------------------------------------------------
   Skills catalog
   -----------------------------------------------------------
   Lists every SKILL.md discovered from disk, grouped by
   source via a segmented control:
     - builtin-auto    → injected into every new conversation
                         unless disabled by the profile
     - builtin-opt-in  → only when the profile names them
     - user            → only when the profile names them

   Clicking a card opens a modal showing the full markdown
   body so the user can read what they're about to authorize
   the agent to do.
   ----------------------------------------------------------- */

type Tab = SkillSource | 'all'

const TAB_ORDER: Tab[] = ['all', 'builtin-auto', 'builtin-opt-in', 'user']
const TAB_LABEL: Record<Tab, string> = {
  all: 'All',
  'builtin-auto': 'Auto-inject',
  'builtin-opt-in': 'Opt-in',
  user: 'User',
}

type Banner = { kind: 'error' | 'success'; message: string }

export function SkillsPage() {
  const [skills, setSkills] = useState<SkillSummary[] | null>(null)
  const [tab, setTab] = useState<Tab>('all')
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [openSkill, setOpenSkill] = useState<string | null>(null)

  async function refresh() {
    try {
      const items = await listSkills()
      setSkills(items)
    } catch (e) {
      setBanner({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Failed to load skills.',
      })
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function handleReload() {
    setBusy(true)
    setBanner(null)
    try {
      const r = await reloadSkills()
      await refresh()
      setBanner({
        kind: 'success',
        message: `Re-read disk — found ${r.count} skill${r.count === 1 ? '' : 's'}.`,
      })
    } catch (e) {
      setBanner({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Reload failed.',
      })
    } finally {
      setBusy(false)
    }
  }

  const counts = useMemo<Record<Tab, number>>(() => {
    const total = skills?.length ?? 0
    const out: Record<Tab, number> = {
      all: total,
      'builtin-auto': 0,
      'builtin-opt-in': 0,
      user: 0,
    }
    for (const s of skills ?? []) out[s.source]++
    return out
  }, [skills])

  const filtered = useMemo(() => {
    if (!skills) return []
    if (tab === 'all') return skills
    return skills.filter((s) => s.source === tab)
  }, [skills, tab])

  return (
    <div className='flex flex-1 flex-col overflow-y-auto bg-background'>
      <div className='mx-auto w-full max-w-[1240px] px-7 pb-12'>
        {/* Header */}
        <div className='flex flex-col gap-6 pt-7 sm:flex-row sm:items-start sm:justify-between'>
          <div>
            <h1 className='text-[30px] font-semibold leading-[1.1] tracking-[-0.025em]'>
              Skills
            </h1>
            <p className='mt-2 max-w-xl text-[14px] leading-relaxed text-muted-foreground'>
              Markdown SKILL.md files discovered from disk.{' '}
              <span className='text-foreground/80'>Auto-inject</span> skills go
              into every new conversation unless disabled by the active profile;{' '}
              <span className='text-foreground/80'>opt-in</span> and{' '}
              <span className='text-foreground/80'>user</span> skills only
              activate when the profile names them.
            </p>
          </div>
          <button
            type='button'
            onClick={() => void handleReload()}
            disabled={busy}
            className='inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3.5 text-[13.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50'
          >
            <RefreshCwIcon className='size-[15px]' strokeWidth={2} />
            Reload from disk
          </button>
        </div>

        {banner && (
          <div
            role='status'
            className={cn(
              'mt-5 rounded-md border px-3.5 py-2.5 text-[13px]',
              banner.kind === 'error'
                ? 'border-[color-mix(in_oklab,var(--destructive)_40%,var(--border))] bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] text-destructive'
                : 'border-[color-mix(in_oklab,var(--anubis-gold)_40%,var(--border))] bg-[color-mix(in_oklab,var(--anubis-gold)_8%,transparent)] text-foreground',
            )}
          >
            {banner.message}
          </div>
        )}

        {/* Tabs */}
        <div className='mt-7 inline-flex gap-0.5 rounded-md border border-border bg-background p-[3px]'>
          {TAB_ORDER.map((t) => {
            const active = t === tab
            return (
              <button
                key={t}
                type='button'
                onClick={() => setTab(t)}
                aria-pressed={active}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-[5px] px-3 text-[12.5px] font-medium transition-colors',
                  active
                    ? 'bg-card text-foreground shadow-[inset_0_-2px_0_var(--anubis-gold)]'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {TAB_LABEL[t]}
                <span
                  className={cn(
                    'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-sm px-1 font-mono text-[10px] tabular-nums',
                    active
                      ? 'bg-[color-mix(in_oklab,var(--anubis-gold)_18%,transparent)] text-[var(--anubis-gold)]'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {counts[t]}
                </span>
              </button>
            )
          })}
        </div>

        {/* Grid */}
        {skills === null ? (
          <LoadingGrid />
        ) : filtered.length === 0 ? (
          <EmptyState tab={tab} />
        ) : (
          <div className='mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'>
            {filtered.map((s) => (
              <SkillCard key={s.name} skill={s} onView={() => setOpenSkill(s.name)} />
            ))}
          </div>
        )}
      </div>

      <SkillBodyDialog
        skillName={openSkill}
        onClose={() => setOpenSkill(null)}
      />
    </div>
  )
}

/* ---------- Card ---------- */

function SkillCard({
  skill,
  onView,
}: {
  skill: SkillSummary
  onView: () => void
}) {
  return (
    <article
      className={cn(
        'group flex flex-col gap-2.5 rounded-md border border-border bg-card p-4 transition-colors',
        'hover:border-[color-mix(in_oklab,var(--anubis-gold)_28%,var(--border))]',
      )}
    >
      <div className='flex items-start justify-between gap-3'>
        <h3 className='truncate font-mono text-[13px] font-semibold text-foreground'>
          {skill.name}
        </h3>
        <SourceBadge source={skill.source} />
      </div>

      <p className='text-[13px] leading-[1.5] text-foreground'>
        {skill.description || (
          <span className='italic text-muted-foreground'>No description.</span>
        )}
      </p>

      {skill.whenToUse && (
        <div className='flex flex-col gap-0.5'>
          <span className='font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground'>
            When to use
          </span>
          <p className='line-clamp-2 text-[12.5px] italic leading-[1.45] text-muted-foreground'>
            {skill.whenToUse}
          </p>
        </div>
      )}

      <div className='mt-auto pt-3'>
        <button
          type='button'
          onClick={onView}
          className='inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium text-[var(--anubis-gold)] transition-colors hover:bg-[color-mix(in_oklab,var(--anubis-gold)_10%,transparent)]'
        >
          <BookOpenIcon className='size-[13px]' strokeWidth={2} />
          View body
        </button>
      </div>
    </article>
  )
}

function SourceBadge({ source }: { source: SkillSource }) {
  if (source === 'builtin-auto') {
    return (
      <span className='inline-flex shrink-0 items-center gap-1 rounded-md border border-[color-mix(in_oklab,var(--anubis-gold)_38%,transparent)] bg-[color-mix(in_oklab,var(--anubis-gold)_16%,transparent)] px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.08em] text-[var(--anubis-gold)]'>
        <CheckCircle2Icon className='size-2.5' strokeWidth={2} />
        Auto
      </span>
    )
  }
  if (source === 'builtin-opt-in') {
    return (
      <span className='inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground'>
        <CircleDashedIcon className='size-2.5' strokeWidth={2} />
        Opt-in
      </span>
    )
  }
  return (
    <span className='inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground'>
      <FolderIcon className='size-2.5' strokeWidth={2} />
      User
    </span>
  )
}

/* ---------- Skill body dialog ---------- */

function SkillBodyDialog({
  skillName,
  onClose,
}: {
  skillName: string | null
  onClose: () => void
}) {
  const [detail, setDetail] = useState<SkillDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!skillName) {
      setDetail(null)
      setError(null)
      return
    }
    let active = true
    setDetail(null)
    setError(null)
    getSkill(skillName)
      .then((d) => {
        if (active) setDetail(d)
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      active = false
    }
  }, [skillName])

  return (
    <Dialog open={skillName !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='max-h-[85vh] max-w-3xl overflow-hidden bg-card p-0'>
        <DialogHeader className='border-b border-border px-6 py-4'>
          <DialogTitle className='font-mono text-[14px] text-foreground'>
            {skillName}
          </DialogTitle>
          {detail && (
            <DialogDescription className='text-[13px] text-muted-foreground'>
              {detail.description}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className='max-h-[60vh] overflow-y-auto px-6 py-4'>
          {error ? (
            <p className='text-[13px] text-destructive'>{error}</p>
          ) : detail ? (
            <pre className='whitespace-pre-wrap break-words font-mono text-[12.5px] leading-[1.65] text-foreground'>
              {detail.body.trim()}
            </pre>
          ) : (
            <p className='font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground'>
              Loading…
            </p>
          )}
        </div>

        {detail && (
          <div className='border-t border-border px-6 py-3'>
            <p className='font-mono text-[10.5px] text-muted-foreground' title={detail.path}>
              <span className='text-foreground/80'>Path:</span> {detail.path}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ---------- Empty + loading ---------- */

function LoadingGrid() {
  return (
    <div className='mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className='h-[148px] animate-pulse rounded-md border border-border bg-card'
        />
      ))}
    </div>
  )
}

function EmptyState({ tab }: { tab: Tab }) {
  const hints: Record<Tab, string> = {
    all: 'No skills found. Drop SKILL.md files under packages/ai-agent/skills/ (built-in) or your user skills directory, then click Reload from disk.',
    'builtin-auto': 'No auto-inject skills shipped yet. They live under packages/ai-agent/skills/auto-inject/.',
    'builtin-opt-in': 'No opt-in skills shipped yet. They live under packages/ai-agent/skills/opt-in/.',
    user: 'You haven\'t installed any user skills yet. Drop a folder with a SKILL.md into your data dir\'s skills directory.',
  }
  return (
    <div className='mt-5 rounded-md border border-dashed border-border bg-card/50 px-4 py-6 text-center text-[13px] text-muted-foreground'>
      {hints[tab]}
    </div>
  )
}
