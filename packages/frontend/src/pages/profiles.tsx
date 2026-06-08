import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CopyIcon,
  FolderIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Trash2Icon,
} from 'lucide-react'

import type { ProfileSummary } from '@anubis/shared'

import {
  copyProfile,
  createProfile,
  deleteProfile,
  getProfile,
  listProfiles,
  resetProfileHome,
} from '@/api'
import { cn } from '@/lib/utils'
import { useNavigation } from '@/lib/navigation'

/* -----------------------------------------------------------
   Profiles screen
   -----------------------------------------------------------
   - Lists every profile (builtin + user), grouped by source.
   - "New Profile" creates a user profile seeded with sensible
     Claude defaults; the user can then tweak it via the (future)
     editor.
   - "Copy" duplicates any profile — builtin or user — as a
     new user-source profile carrying the same config. The
     backend already forces source='user' on POST /profiles,
     so this is pure client-side composition.
   ----------------------------------------------------------- */

type Banner =
  | { kind: 'error'; message: string }
  | { kind: 'success'; message: string }

const DEFAULT_NEW_PROFILE_CONFIG = {
  agent: 'claude',
  model: 'claude-sonnet-4-6',
  permissionMode: 'plan',
} as const

export function ProfilesPage() {
  const { navigate } = useNavigation()
  const [profiles, setProfiles] = useState<ProfileSummary[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState<Banner | null>(null)

  const refresh = useCallback(async () => {
    try {
      const items = await listProfiles()
      setProfiles(items)
    } catch (e) {
      setBanner({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Failed to load profiles.',
      })
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const grouped = useMemo(() => {
    const builtin: ProfileSummary[] = []
    const user: ProfileSummary[] = []
    for (const p of profiles ?? []) {
      ;(p.source === 'builtin' ? builtin : user).push(p)
    }
    return { builtin, user }
  }, [profiles])

  async function handleNew() {
    setBusy(true)
    setBanner(null)
    try {
      const created = await createProfile({
        name: 'Untitled profile',
        description: 'A new profile — rename, pick a model, then start using it.',
        config: { ...DEFAULT_NEW_PROFILE_CONFIG },
      })
      await refresh()
      navigate({ page: 'profile-editor', profileId: created.id })
    } catch (e) {
      setBanner({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Could not create the profile.',
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleCopy(source: ProfileSummary) {
    setBusy(true)
    setBanner(null)
    try {
      const copied = await copyProfile(source.id, {
        name: `${source.name} (copy)`,
        description: source.description,
      })
      await refresh()
      setBanner({
        kind: 'success',
        message: `Copied to "${copied.name}" — credentials carried over.`,
      })
    } catch (e) {
      setBanner({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Could not copy the profile.',
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(source: ProfileSummary) {
    if (source.source !== 'user') return
    const ok = window.confirm(`Delete "${source.name}"? This can't be undone.`)
    if (!ok) return
    setBusy(true)
    setBanner(null)
    try {
      await deleteProfile(source.id)
      await refresh()
      setBanner({ kind: 'success', message: `Deleted "${source.name}".` })
    } catch (e) {
      setBanner({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Could not delete the profile.',
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleResetHome(source: ProfileSummary) {
    const ok = window.confirm(
      `Reset profile data for "${source.name}"?\n\n` +
        `This deletes the agent's auth tokens, MCP config, and session ` +
        `history for this profile. You'll be asked to log in again the ` +
        `next time you use it.`,
    )
    if (!ok) return
    setBusy(true)
    setBanner(null)
    try {
      const { existed } = await resetProfileHome(source.id)
      await refresh()
      setBanner({
        kind: 'success',
        message: existed
          ? `Reset profile data for "${source.name}".`
          : `Nothing to reset — "${source.name}" hadn't been used yet.`,
      })
    } catch (e) {
      setBanner({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Could not reset the profile.',
      })
    } finally {
      setBusy(false)
    }
  }

  const total = profiles?.length ?? 0

  return (
    <div className='flex flex-1 flex-col overflow-y-auto bg-background'>
      <div className='mx-auto w-full max-w-[1240px] px-7 pb-12'>
        {/* Header */}
        <div className='flex flex-col gap-6 pt-7 sm:flex-row sm:items-start sm:justify-between'>
          <div>
            <h1 className='text-[30px] font-semibold leading-[1.1] tracking-[-0.025em]'>
              Profiles
            </h1>
            <p className='mt-2 max-w-xl text-[14px] leading-relaxed text-muted-foreground'>
              {total === 0
                ? 'No profiles yet. Create one to start a conversation.'
                : `${total} profile${total === 1 ? '' : 's'} — built-in presets and your own.`}
            </p>
          </div>
          <div className='flex shrink-0 items-center gap-2.5'>
            <button
              type='button'
              onClick={() => void refresh()}
              disabled={busy}
              className='inline-flex h-9 items-center gap-2 rounded-md px-3.5 text-[13.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50'
            >
              <RefreshCwIcon className='size-[15px]' strokeWidth={2} />
              Refresh
            </button>
            <button
              type='button'
              onClick={() => void handleNew()}
              disabled={busy}
              className='inline-flex h-9 items-center gap-2 rounded-md bg-[var(--anubis-gold)] px-3.5 text-[13.5px] font-semibold text-[#0B0C0F] transition-colors hover:bg-[var(--anubis-gold-deep)] disabled:cursor-not-allowed disabled:opacity-50'
            >
              <PlusIcon className='size-[15px]' strokeWidth={2.4} />
              New Profile
            </button>
          </div>
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

        {profiles === null ? (
          <LoadingGrid />
        ) : (
          <>
            <Section title='Built-in'>
              <ProfileGrid
                profiles={grouped.builtin}
                onCopy={handleCopy}
                onEdit={(p) => navigate({ page: 'profile-editor', profileId: p.id })}
                onResetHome={handleResetHome}
                busy={busy}
              />
            </Section>

            <Section
              title='My profiles'
              emptyHint='No custom profiles yet. Tap "New Profile" to scaffold one, or copy a built-in to start.'
              show
            >
              <ProfileGrid
                profiles={grouped.user}
                onCopy={handleCopy}
                onEdit={(p) => navigate({ page: 'profile-editor', profileId: p.id })}
                onDelete={handleDelete}
                onResetHome={handleResetHome}
                busy={busy}
              />
            </Section>
          </>
        )}
      </div>
    </div>
  )
}

/* ---------- Section header ---------- */

function Section({
  title,
  children,
  emptyHint,
  show = false,
}: {
  title: string
  children: React.ReactNode
  emptyHint?: string
  show?: boolean
}) {
  const isEmpty =
    Array.isArray(children) === false &&
    (children as React.ReactElement<{ profiles?: ProfileSummary[] }> | null)?.props?.profiles?.length === 0
  if (isEmpty && !show && !emptyHint) return null
  return (
    <section className='mt-8'>
      <h2 className='mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>
        {title}
      </h2>
      {isEmpty && emptyHint ? (
        <p className='rounded-md border border-dashed border-border bg-card/50 px-3.5 py-4 text-[13px] text-muted-foreground'>
          {emptyHint}
        </p>
      ) : (
        children
      )}
    </section>
  )
}

/* ---------- Card grid ---------- */

function ProfileGrid({
  profiles,
  onCopy,
  onEdit,
  onDelete,
  onResetHome,
  busy,
}: {
  profiles: ProfileSummary[]
  onCopy: (p: ProfileSummary) => void
  onEdit: (p: ProfileSummary) => void
  onDelete?: (p: ProfileSummary) => void
  onResetHome: (p: ProfileSummary) => void
  busy: boolean
}) {
  if (profiles.length === 0) return null
  return (
    <div className='grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'>
      {profiles.map((p) => (
        <ProfileCard
          key={p.id}
          profile={p}
          onCopy={() => onCopy(p)}
          onEdit={() => onEdit(p)}
          onDelete={onDelete ? () => onDelete(p) : undefined}
          onResetHome={() => onResetHome(p)}
          busy={busy}
        />
      ))}
    </div>
  )
}

function ProfileCard({
  profile,
  onCopy,
  onEdit,
  onDelete,
  onResetHome,
  busy,
}: {
  profile: ProfileSummary
  onCopy: () => void
  onEdit: () => void
  onDelete?: () => void
  onResetHome: () => void
  busy: boolean
}) {
  const agent = profile.config.agent
  const model =
    typeof profile.config.model === 'string' ? profile.config.model : undefined

  return (
    <article
      className={cn(
        'group relative flex flex-col gap-3 overflow-hidden rounded-md border border-border bg-card p-4 transition-colors',
        'hover:border-[color-mix(in_oklab,var(--anubis-gold)_28%,var(--border))]',
      )}
    >
      <header className='flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <h3 className='truncate text-[15px] font-semibold leading-tight tracking-[-0.01em] text-foreground'>
            {profile.name}
          </h3>
          <p className='mt-1 font-mono text-[11.5px] text-muted-foreground'>
            {profile.id}
          </p>
        </div>
        <SourceBadge source={profile.source} />
      </header>

      <div className='flex flex-wrap items-center gap-1.5'>
        <AgentChip agent={agent} />
        {model && (
          <span className='inline-flex h-[22px] items-center rounded-md border border-border bg-muted px-2 font-mono text-[11px] text-muted-foreground'>
            {model}
          </span>
        )}
        {profile.lastUsedAt && (
          <span className='font-mono text-[11px] text-muted-foreground/70'>
            · used {relativeTime(profile.lastUsedAt)}
          </span>
        )}
      </div>

      {profile.description && (
        <p className='line-clamp-2 text-[13px] leading-[1.5] text-muted-foreground'>
          {profile.description}
        </p>
      )}

      {profile.home && <HomeBlock home={profile.home} />}

      <div className='mt-1 flex items-center gap-2 border-t border-border pt-3'>
        <button
          type='button'
          onClick={onCopy}
          disabled={busy}
          className='inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[12.5px] font-medium text-foreground transition-colors hover:border-[color-mix(in_oklab,var(--anubis-gold)_45%,var(--border))] hover:bg-muted disabled:opacity-50'
        >
          <CopyIcon className='size-[13px]' strokeWidth={2} />
          Copy
        </button>

        <button
          type='button'
          onClick={onEdit}
          disabled={busy}
          className='inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50'
        >
          Edit
        </button>

        <button
          type='button'
          onClick={onResetHome}
          disabled={busy || !profile.home?.exists}
          title={
            profile.home?.exists
              ? 'Reset auth, MCP config, and session history for this profile'
              : 'Nothing to reset — this profile has not been used yet'
          }
          className='inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40'
        >
          <RotateCcwIcon className='size-[13px]' strokeWidth={2} />
          Reset
        </button>

        {onDelete && (
          <button
            type='button'
            onClick={onDelete}
            disabled={busy}
            className='ml-auto inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-[color-mix(in_oklab,var(--destructive)_12%,transparent)] hover:text-destructive disabled:opacity-50'
            aria-label={`Delete ${profile.name}`}
          >
            <Trash2Icon className='size-[13px]' strokeWidth={2} />
            Delete
          </button>
        )}
      </div>
    </article>
  )
}

function HomeBlock({ home }: { home: NonNullable<ProfileSummary['home']> }) {
  return (
    <div className='flex items-start gap-2 rounded-md border border-border bg-background px-2.5 py-2'>
      <FolderIcon
        className={cn(
          'mt-0.5 size-[13px] shrink-0',
          home.exists ? 'text-[var(--anubis-gold)]' : 'text-muted-foreground/60',
        )}
        strokeWidth={1.6}
      />
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-2'>
          <span className='font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground'>
            Home
          </span>
          <span
            className={cn(
              'inline-flex h-4 items-center rounded-sm px-1.5 font-mono text-[9.5px] uppercase tracking-[0.08em]',
              home.exists
                ? 'bg-[color-mix(in_oklab,var(--anubis-success)_18%,transparent)] text-[var(--anubis-success)]'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {home.exists ? 'Provisioned' : 'Empty'}
          </span>
        </div>
        <p
          className='mt-0.5 truncate font-mono text-[11px] text-muted-foreground'
          title={home.path}
          dir='rtl'
        >
          {home.path}
        </p>
      </div>
    </div>
  )
}

/* ---------- Bits ---------- */

function SourceBadge({ source }: { source: ProfileSummary['source'] }) {
  if (source === 'builtin') {
    return (
      <span className='inline-flex shrink-0 items-center rounded-md border border-[color-mix(in_oklab,var(--anubis-gold)_38%,transparent)] bg-[color-mix(in_oklab,var(--anubis-gold)_16%,transparent)] px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-[var(--anubis-gold)]'>
        Built-in
      </span>
    )
  }
  return (
    <span className='inline-flex shrink-0 items-center rounded-md border border-border bg-muted px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground'>
      Custom
    </span>
  )
}

const AGENT_LABEL: Record<ProfileSummary['config']['agent'], string> = {
  claude: 'Claude',
  codex: 'Codex',
  antigravity: 'Antigravity',
  'gpt-web': 'GPT Web',
}

function AgentChip({ agent }: { agent: ProfileSummary['config']['agent'] }) {
  return (
    <span className='inline-flex h-[22px] items-center gap-1.5 rounded-md border border-border bg-background px-2 font-mono text-[11px] text-foreground'>
      <span className='inline-block size-1.5 rounded-full bg-[var(--anubis-gold)]' />
      {AGENT_LABEL[agent]}
    </span>
  )
}

function LoadingGrid() {
  return (
    <div className='mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className='h-[154px] animate-pulse rounded-md border border-border bg-card'
        />
      ))}
    </div>
  )
}

function relativeTime(ms: number): string {
  const d = Date.now() - ms
  const min = Math.round(d / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  return `${day}d ago`
}
