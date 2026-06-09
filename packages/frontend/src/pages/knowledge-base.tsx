import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DatabaseIcon,
  FileTextIcon,
  FolderInputIcon,
  RefreshCwIcon,
  SearchIcon,
  ShieldIcon,
} from 'lucide-react'
import type {
  KnowledgeBaseDocument,
  KnowledgeBaseSearchHit,
  KnowledgeBaseStats,
} from '@anubis/shared'
import {
  indexKnowledgeBase,
  searchKnowledgeBase,
} from '@/api'
import { useProject } from '@/lib/use-project'
import { cn } from '@/lib/utils'
import { useKbLoader } from '@/lib/use-kb-loader'

type Banner = { kind: 'success' | 'error'; message: string }

type IndexMode = 'all' | 'file' | 'folder'

export function KnowledgeBasePage() {
  const { activeProject } = useProject()
  const projectId = activeProject?.id
  const projectWorkdir = activeProject?.workdir

  // Read state reactively from the global background loader store
  const backgroundLoading = useKbLoader((s) => s.loading)
  const stats = useKbLoader((s) => projectId ? s.kbStats[projectId] : null) || null
  const docs = useKbLoader((s) => projectId ? s.kbDocs[projectId] : null) || null
  const ignoreFile = useKbLoader((s) => projectId ? s.kbIgnoreFiles[projectId] : null) || null
  const loadProjectData = useKbLoader((s) => s.loadProjectData)

  const [busy, setBusy] = useState(false)
  const [indexing, setIndexing] = useState<IndexMode | null>(null)
  const [banner, setBanner] = useState<Banner | null>(null)

  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [hits, setHits] = useState<KnowledgeBaseSearchHit[] | null>(null)

  const refresh = useCallback(async () => {
    if (!projectId || !projectWorkdir) return
    setBusy(true); setBanner(null)
    try {
      await loadProjectData(projectId, true)
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Refresh failed.' })
    } finally {
      setBusy(false)
    }
  }, [projectId, projectWorkdir, loadProjectData])

  const loaded = stats !== null
  const hasIndex = (stats?.documentCount ?? 0) > 0

  async function handleIndex(mode: IndexMode) {
    if (!projectId) return
    setIndexing(mode); setBanner(null)
    try {
      let paths: string[] | undefined
      if (mode === 'file' || mode === 'folder') {
        const picked = window.prompt(
          mode === 'file'
            ? 'Absolute path of file to index:'
            : 'Absolute path of folder to index:',
          projectWorkdir ?? '',
        )
        if (!picked) { setIndexing(null); return }
        paths = [picked]
      }
      const result = await indexKnowledgeBase({ projectId, paths })
      const msg = result.createdIgnoreFile
        ? `Indexed ${result.indexed.length} target(s). Created .anubisignore at workspace root.`
        : `Indexed ${result.indexed.length} target(s).`
      setBanner({ kind: 'success', message: msg })
      await refresh()
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Indexing failed.' })
    } finally {
      setIndexing(null)
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!projectId || !query.trim()) return
    setSearching(true); setBanner(null)
    try {
      const r = await searchKnowledgeBase({ projectId, query: query.trim(), limit: 20 })
      setHits(r.hits)
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Search failed.' })
    } finally {
      setSearching(false)
    }
  }

  const lastIndexedLabel = useMemo(() => formatTime(stats?.lastIndexedAt), [stats?.lastIndexedAt])

  if (!projectId) {
    return (
      <EmptyState
        title='Pick a project to use Knowledge Base'
        body='Each project has its own Knowledge Base, scoped to the project workspace. Create or select a project from the top bar.'
      />
    )
  }

  if (!projectWorkdir) {
    return (
      <EmptyState
        title='This project has no workspace folder'
        body='Set a workspace path on the project before using its Knowledge Base. The engine indexes the workspace folder itself.'
      />
    )
  }

  return (
    <div className='flex flex-1 flex-col overflow-y-auto bg-background'>
      <div className='mx-auto w-full max-w-[1080px] px-7 pb-16'>
        <div className='flex flex-col gap-4 pt-7'>
          <div className='flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between'>
            <div>
              <h1 className='text-[28px] font-semibold leading-[1.1] tracking-[-0.025em]'>Knowledge Base</h1>
              <p className='mt-1.5 max-w-xl text-[13.5px] leading-relaxed text-muted-foreground'>
                Per-project searchable corpus. Indexes <code className='font-mono text-foreground/80'>{projectWorkdir}</code> filtered by <code className='font-mono text-foreground/80'>.anubisignore</code>.
              </p>
            </div>
            <button
              type='button'
              onClick={() => void refresh()}
              disabled={busy || backgroundLoading}
              className='inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[13px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50'
            >
              <RefreshCwIcon className={cn('size-[14px]', (busy || backgroundLoading) && 'animate-spin')} strokeWidth={1.8} />
              Refresh
            </button>
          </div>
        </div>

        {banner && (
          <div role='status' className={cn(
            'mt-5 rounded-md border px-3.5 py-2.5 text-[13px]',
            banner.kind === 'error'
              ? 'border-[color-mix(in_oklab,var(--destructive)_40%,var(--border))] bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] text-destructive'
              : 'border-[color-mix(in_oklab,var(--anubis-gold)_40%,var(--border))] bg-[color-mix(in_oklab,var(--anubis-gold)_8%,transparent)] text-foreground',
          )}>
            {banner.message}
          </div>
        )}

        <section className='mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4'>
          <StatCard label='Documents' value={stats?.documentCount ?? '—'} />
          <StatCard label='Chunks' value={stats?.chunkCount ?? '—'} />
          <StatCard label='Entities' value={stats?.entityCount ?? '—'} />
          <StatCard label='Edges' value={stats?.edgeCount ?? '—'} />
        </section>

        <p className='mt-3 text-[12px] text-muted-foreground'>
          Last indexed: <span className='font-mono text-foreground/80'>{loaded ? lastIndexedLabel : 'unknown'}</span>
        </p>

        {!loaded && (
          <section className='mt-8 rounded-lg border border-dashed border-border bg-card/60 p-8'>
            <div className='flex flex-col items-center gap-3 text-center'>
              <DatabaseIcon className={cn('size-8 text-muted-foreground', backgroundLoading && 'animate-pulse text-[var(--anubis-gold)]')} strokeWidth={1.5} />
              <h2 className='text-[16px] font-semibold'>
                {backgroundLoading ? 'Connecting to engine in background...' : 'Status not loaded'}
              </h2>
              <p className='max-w-md text-[13px] text-muted-foreground'>
                {backgroundLoading
                  ? 'Anubis is loading the project index statistics and ignore rules in the background. Please wait.'
                  : 'Opening this page is free — Anubis does not auto-query the engine. Click Refresh to load index stats and documents, or jump straight to indexing below.'}
              </p>
              <div className='mt-2 flex flex-wrap items-center justify-center gap-2'>
                <button
                  type='button'
                  onClick={() => void refresh()}
                  disabled={busy || backgroundLoading}
                  className='inline-flex h-10 items-center gap-2 rounded-md border border-border bg-card px-4 text-[13.5px] font-medium text-foreground transition-colors hover:bg-card/70 disabled:opacity-50'
                >
                  <RefreshCwIcon className={cn('size-[15px]', (busy || backgroundLoading) && 'animate-spin')} strokeWidth={1.8} />
                  {busy || backgroundLoading ? 'Loading…' : 'Refresh'}
                </button>
                <button
                  type='button'
                  onClick={() => void handleIndex('all')}
                  disabled={indexing !== null}
                  className='inline-flex h-10 items-center gap-2 rounded-md bg-[var(--anubis-gold)] px-5 text-[13.5px] font-semibold text-[#0B0C0F] transition-colors hover:bg-[var(--anubis-gold-deep)] disabled:opacity-50'
                >
                  {indexing === 'all' ? 'Indexing…' : 'Index this project now'}
                </button>
              </div>
            </div>
          </section>
        )}

        {loaded && !hasIndex && (
          <section className='mt-8 rounded-lg border border-dashed border-border bg-card/60 p-8'>
            <div className='flex flex-col items-center gap-3 text-center'>
              <DatabaseIcon className='size-8 text-muted-foreground' strokeWidth={1.5} />
              <h2 className='text-[16px] font-semibold'>No documents indexed yet</h2>
              <p className='max-w-md text-[13px] text-muted-foreground'>
                Indexing the workspace will respect <code className='font-mono'>.anubisignore</code>. On first index, Anubis creates a default ignore file at the workspace root if none exists.
              </p>
              <button
                type='button'
                onClick={() => void handleIndex('all')}
                disabled={indexing !== null}
                className='mt-2 inline-flex h-10 items-center gap-2 rounded-md bg-[var(--anubis-gold)] px-5 text-[13.5px] font-semibold text-[#0B0C0F] transition-colors hover:bg-[var(--anubis-gold-deep)] disabled:opacity-50'
              >
                {indexing === 'all' ? 'Indexing…' : 'Index this project now'}
              </button>
            </div>
          </section>
        )}

        {hasIndex && (
          <section className='mt-8 border-t border-border pt-6'>
            <div className='flex flex-wrap items-center gap-2'>
              <button
                type='button'
                onClick={() => void handleIndex('all')}
                disabled={indexing !== null}
                className='inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--anubis-gold)] px-3.5 text-[13px] font-semibold text-[#0B0C0F] transition-colors hover:bg-[var(--anubis-gold-deep)] disabled:opacity-50'
              >
                <RefreshCwIcon className='size-[14px]' strokeWidth={1.8} />
                {indexing === 'all' ? 'Re-indexing…' : 'Re-index project'}
              </button>
              <button
                type='button'
                onClick={() => void handleIndex('folder')}
                disabled={indexing !== null}
                className='inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[13px] text-foreground transition-colors hover:bg-card/70 disabled:opacity-50'
              >
                <FolderInputIcon className='size-[14px]' strokeWidth={1.8} />
                Index a folder…
              </button>
              <button
                type='button'
                onClick={() => void handleIndex('file')}
                disabled={indexing !== null}
                className='inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[13px] text-foreground transition-colors hover:bg-card/70 disabled:opacity-50'
              >
                <FileTextIcon className='size-[14px]' strokeWidth={1.8} />
                Index a file…
              </button>
            </div>
          </section>
        )}

        <section className='mt-8 border-t border-border pt-6'>
          <h2 className='font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>Search</h2>
          <p className='mt-1 text-[12.5px] leading-relaxed text-muted-foreground'>
            Manual probe of the engine. Useful for debugging retrieval.
          </p>
          <form onSubmit={handleSearch} className='mt-3 flex items-center gap-2'>
            <div className='relative flex-1'>
              <SearchIcon className='pointer-events-none absolute left-3 top-1/2 size-[15px] -translate-y-1/2 text-muted-foreground' strokeWidth={1.8} />
              <input
                type='text'
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder='Search the knowledge base…'
                spellCheck={false}
                className='h-10 w-full rounded-md border border-border bg-card pl-9 pr-3 text-[13px] text-foreground outline-none focus:border-[color-mix(in_oklab,var(--anubis-gold)_50%,var(--border))]'
              />
            </div>
            <button
              type='submit'
              disabled={!query.trim() || searching}
              className='inline-flex h-10 items-center rounded-md bg-[var(--anubis-gold)] px-4 text-[13px] font-semibold text-[#0B0C0F] transition-colors hover:bg-[var(--anubis-gold-deep)] disabled:opacity-50'
            >
              {searching ? 'Searching…' : 'Search'}
            </button>
          </form>

          {hits && (
            <ul className='mt-4 flex flex-col gap-2'>
              {hits.length === 0
                ? <li className='text-[12.5px] text-muted-foreground'>No hits.</li>
                : hits.map((h, i) => (
                  <li key={`${h.chunkId}-${i}`} className='rounded-md border border-border bg-card px-3.5 py-2.5'>
                    <div className='flex items-baseline justify-between gap-3'>
                      <span className='truncate font-mono text-[12px] text-muted-foreground'>{h.path || '(no path)'}</span>
                      {h.score !== undefined && (
                        <span className='font-mono text-[11px] text-muted-foreground'>{h.score.toFixed(3)}</span>
                      )}
                    </div>
                    <p className='mt-1 line-clamp-3 text-[13px] text-foreground/90'>{h.snippet || '(no snippet)'}</p>
                  </li>
                ))}
            </ul>
          )}
        </section>

        {docs && docs.length > 0 && (
          <section className='mt-8 border-t border-border pt-6'>
            <h2 className='font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>Indexed documents ({docs.length})</h2>
            <ul className='mt-3 flex max-h-[420px] flex-col gap-1 overflow-y-auto rounded-md border border-border bg-card p-2'>
              {docs.map((d) => (
                <li key={d.id} className='flex items-baseline justify-between gap-3 rounded px-2 py-1.5 font-mono text-[12px] hover:bg-background'>
                  <span className='truncate text-foreground/90'>{d.path || d.id}</span>
                  {d.chunkCount !== undefined && (
                    <span className='shrink-0 text-muted-foreground'>{d.chunkCount} chunks</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className='mt-8 border-t border-border pt-6'>
          <h2 className='flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>
            <ShieldIcon className='size-[13px]' strokeWidth={1.8} />
            .anubisignore
          </h2>
          <p className='mt-1 text-[12.5px] leading-relaxed text-muted-foreground'>
            Gitignore-style patterns at the workspace root. The engine does <em>not</em> honour <code className='font-mono'>.gitignore</code>; only this file. Edit it directly in your editor — Anubis writes a default on first index but never touches it afterwards.
          </p>
          {ignoreFile && ignoreFile.exists ? (
            <pre className='mt-3 max-h-[260px] overflow-auto rounded-md border border-border bg-card p-3 font-mono text-[11.5px] leading-relaxed text-muted-foreground'>
              {ignoreFile.content}
            </pre>
          ) : (
            <p className='mt-3 rounded-md border border-dashed border-border bg-card/60 px-3 py-2.5 text-[12px] text-muted-foreground'>
              No <code className='font-mono'>.anubisignore</code> yet — one will be created at first index.
            </p>
          )}
          {ignoreFile && (
            <p className='mt-2 text-[11px] text-muted-foreground'>
              Path: <span className='font-mono text-foreground/70'>{ignoreFile.path}</span>
            </p>
          )}
        </section>
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className='rounded-md border border-border bg-card px-3.5 py-3'>
      <div className='font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>{label}</div>
      <div className='mt-1 font-mono text-[22px] tabular-nums text-foreground'>{value}</div>
    </div>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className='flex flex-1 items-center justify-center bg-background'>
      <div className='mx-auto flex max-w-md flex-col items-center gap-3 px-7 text-center'>
        <DatabaseIcon className='size-8 text-muted-foreground' strokeWidth={1.5} />
        <h1 className='text-[20px] font-semibold leading-tight'>{title}</h1>
        <p className='text-[13px] leading-relaxed text-muted-foreground'>{body}</p>
      </div>
    </div>
  )
}

function formatTime(ts?: number): string {
  if (!ts) return 'never'
  return new Date(ts).toLocaleString()
}
