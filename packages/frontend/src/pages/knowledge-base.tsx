import { useCallback, useEffect, useState } from 'react'
import {
  DatabaseIcon, FilePlusIcon, FolderTreeIcon, PencilIcon,
  RefreshCwIcon, SaveIcon, SearchIcon, Trash2Icon, XIcon,
} from 'lucide-react'
import type { KnowledgeBaseFileEntry, KnowledgeBaseSearchHit } from '@anubis/shared'
import {
  deleteKnowledgeBaseFile, getKnowledgeBaseTree, ingestKnowledgeBase,
  readKnowledgeBaseFile, saveKnowledgeBaseFile, searchKnowledgeBase, updateKnowledgeBaseFile,
} from '@/api'
import { useProject } from '@/lib/use-project'
import { cn } from '@/lib/utils'
import { useKbLoader } from '@/lib/use-kb-loader'
import { KnowledgeFileTree } from '@/components/knowledge/file-tree'
import { MarkdownView } from '@/components/knowledge/markdown-view'
import { MarkdownEditor } from '@/components/knowledge/markdown-editor'

type Banner = { kind: 'success' | 'error'; message: string }
type Mode = 'view' | 'edit'

export function KnowledgeBasePage() {
  const { activeProject } = useProject()
  const projectId = activeProject?.id
  const projectWorkdir = activeProject?.workdir

  const stats = useKbLoader((s) => (projectId ? s.kbStats[projectId] : null)) || null
  const loadProjectData = useKbLoader((s) => s.loadProjectData)

  const [tree, setTree] = useState<KnowledgeBaseFileEntry[]>([])
  const [treeLoading, setTreeLoading] = useState(false)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [mode, setMode] = useState<Mode>('view')
  const [editBuffer, setEditBuffer] = useState('')
  const [isNewFile, setIsNewFile] = useState(false)
  const [newPathInput, setNewPathInput] = useState('')
  const [banner, setBanner] = useState<Banner | null>(null)
  const [busy, setBusy] = useState(false)
  const [ingesting, setIngesting] = useState(false)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<KnowledgeBaseSearchHit[] | null>(null)

  const refreshTree = useCallback(async () => {
    if (!projectId) return
    setTreeLoading(true)
    try {
      setTree(await getKnowledgeBaseTree(projectId))
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to load files.' })
    } finally {
      setTreeLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (!projectId) return
    setSelectedPath(null)
    setContent('')
    setMode('view')
    setIsNewFile(false)
    setNewPathInput('')
    setResults(null)
    setBanner(null)
    void refreshTree()
    void loadProjectData(projectId, true)
  }, [projectId, refreshTree, loadProjectData])

  const openFile = useCallback(async (path: string) => {
    if (!projectId) return
    setBusy(true); setBanner(null)
    try {
      const file = await readKnowledgeBaseFile(projectId, path)
      setSelectedPath(file.path)
      setContent(file.content)
      setMode('view')
      setIsNewFile(false)
      setResults(null)
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to open file.' })
    } finally {
      setBusy(false)
    }
  }, [projectId])

  function startEdit() {
    setEditBuffer(content)
    setMode('edit')
    setBanner(null)
  }

  function startNewFile() {
    setIsNewFile(true)
    setNewPathInput('')
    setSelectedPath(null)
    setContent('')
    setEditBuffer('')
    setMode('edit')
    setResults(null)
    setBanner(null)
  }

  function cancelEdit() {
    if (isNewFile) {
      setIsNewFile(false)
      setNewPathInput('')
      setSelectedPath(null)
      setContent('')
    }
    setMode('view')
    setBanner(null)
  }

  async function handleSave() {
    if (!projectId) return
    const path = isNewFile ? newPathInput.trim() : selectedPath
    if (!path) {
      setBanner({ kind: 'error', message: 'Enter a file path ending in .md' })
      return
    }
    setBusy(true); setBanner(null)
    try {
      if (isNewFile) await saveKnowledgeBaseFile({ projectId, path, content: editBuffer })
      else await updateKnowledgeBaseFile({ projectId, path, content: editBuffer })
      setContent(editBuffer)
      setSelectedPath(path)
      setIsNewFile(false)
      setNewPathInput('')
      setMode('view')
      setBanner({ kind: 'success', message: `Saved ${path}.` })
      await refreshTree()
      await loadProjectData(projectId, true)
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Save failed.' })
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!projectId || !selectedPath) return
    if (!window.confirm(`Delete ${selectedPath}? This cannot be undone.`)) return
    setBusy(true); setBanner(null)
    try {
      await deleteKnowledgeBaseFile({ projectId, path: selectedPath })
      setBanner({ kind: 'success', message: `Deleted ${selectedPath}.` })
      setSelectedPath(null)
      setContent('')
      setMode('view')
      await refreshTree()
      await loadProjectData(projectId, true)
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Delete failed.' })
    } finally {
      setBusy(false)
    }
  }

  async function handleIngest() {
    if (!projectId) return
    setIngesting(true); setBanner(null)
    try {
      const r = await ingestKnowledgeBase({ projectId, full: true })
      setBanner({ kind: 'success', message: `Re-indexed ${r.documents} document(s), ${r.chunks} chunk(s).` })
      await refreshTree()
      await loadProjectData(projectId, true)
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Ingest failed.' })
    } finally {
      setIngesting(false)
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!projectId || !query.trim()) return
    setBanner(null)
    try {
      const r = await searchKnowledgeBase({ projectId, query: query.trim(), limit: 20 })
      setResults(r.results)
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Search failed.' })
    }
  }

  if (!projectId) {
    return <EmptyState title='Pick a project to use Knowledge Base'
      body='Each project has its own Knowledge Base, scoped to the project workspace. Create or select a project from the top bar.' />
  }
  if (!projectWorkdir) {
    return <EmptyState title='This project has no workspace folder'
      body='Set a workspace path on the project before using its Knowledge Base.' />
  }

  return (
    <div className='flex flex-1 overflow-hidden bg-background'>
      <aside className='flex w-[300px] shrink-0 flex-col border-r border-border bg-card/40'>
        <div className='flex items-center justify-between gap-2 border-b border-border px-3 py-2.5'>
          <span className='font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>Files</span>
          <div className='flex items-center gap-1'>
            <IconButton title='New file' onClick={startNewFile}><FilePlusIcon className='size-[15px]' strokeWidth={1.8} /></IconButton>
            <IconButton title='Re-index corpus' onClick={() => void handleIngest()} disabled={ingesting}>
              <RefreshCwIcon className={cn('size-[15px]', ingesting && 'animate-spin')} strokeWidth={1.8} />
            </IconButton>
            <IconButton title='Refresh file tree' onClick={() => void refreshTree()} disabled={treeLoading}>
              <FolderTreeIcon className={cn('size-[15px]', treeLoading && 'animate-pulse')} strokeWidth={1.8} />
            </IconButton>
          </div>
        </div>

        <form onSubmit={handleSearch} className='border-b border-border px-3 py-2'>
          <div className='relative'>
            <SearchIcon className='pointer-events-none absolute left-2.5 top-1/2 size-[14px] -translate-y-1/2 text-muted-foreground' strokeWidth={1.8} />
            <input
              type='text' value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder='Search the corpus…' spellCheck={false}
              className='h-8 w-full rounded-md border border-border bg-background pl-8 pr-2 text-[12.5px] text-foreground outline-none focus:border-[color-mix(in_oklab,var(--anubis-gold)_50%,var(--border))]'
            />
          </div>
        </form>

        <div className='flex-1 overflow-y-auto py-1'>
          {results !== null
            ? <SearchResults results={results} onClear={() => setResults(null)} onOpen={(p) => void openFile(p)} />
            : <KnowledgeFileTree entries={tree} selectedPath={selectedPath} onSelect={(p) => void openFile(p)} />}
        </div>

        <div className='border-t border-border px-3 py-2 font-mono text-[10.5px] text-muted-foreground'>
          {stats ? `${stats.documentCount} docs · ${stats.chunkCount} chunks` : '—'}
        </div>
      </aside>

      <main className='flex flex-1 flex-col overflow-hidden'>
        {banner && (
          <div role='status' className={cn(
            'mx-5 mt-4 rounded-md border px-3.5 py-2.5 text-[13px]',
            banner.kind === 'error'
              ? 'border-[color-mix(in_oklab,var(--destructive)_40%,var(--border))] bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] text-destructive'
              : 'border-[color-mix(in_oklab,var(--anubis-gold)_40%,var(--border))] bg-[color-mix(in_oklab,var(--anubis-gold)_8%,transparent)] text-foreground',
          )}>
            {banner.message}
          </div>
        )}

        <div className='flex items-center justify-between gap-3 border-b border-border px-5 py-3'>
          <div className='min-w-0'>
            {isNewFile ? (
              <input
                type='text' autoFocus value={newPathInput} onChange={(e) => setNewPathInput(e.target.value)}
                placeholder='folder/name.md' spellCheck={false}
                className='h-8 w-[320px] max-w-full rounded-md border border-border bg-background px-2.5 font-mono text-[12.5px] text-foreground outline-none focus:border-[color-mix(in_oklab,var(--anubis-gold)_50%,var(--border))]'
              />
            ) : selectedPath ? (
              <span className='block truncate font-mono text-[13px] text-foreground'>{selectedPath}</span>
            ) : (
              <span className='text-[13px] text-muted-foreground'>Select a file to view</span>
            )}
          </div>
          <div className='flex shrink-0 items-center gap-1.5'>
            {mode === 'view' && selectedPath && (
              <>
                <ToolbarButton onClick={startEdit}><PencilIcon className='size-[14px]' strokeWidth={1.8} />Edit</ToolbarButton>
                <ToolbarButton onClick={() => void handleDelete()} tone='danger' disabled={busy}>
                  <Trash2Icon className='size-[14px]' strokeWidth={1.8} />Delete
                </ToolbarButton>
              </>
            )}
            {mode === 'edit' && (
              <>
                <ToolbarButton onClick={() => void handleSave()} tone='gold' disabled={busy}>
                  <SaveIcon className='size-[14px]' strokeWidth={1.8} />Save
                </ToolbarButton>
                <ToolbarButton onClick={cancelEdit}><XIcon className='size-[14px]' strokeWidth={1.8} />Cancel</ToolbarButton>
              </>
            )}
          </div>
        </div>

        <div className='flex-1 overflow-y-auto p-5'>
          {mode === 'edit' ? (
            <MarkdownEditor value={editBuffer} onChange={setEditBuffer} className='min-h-[420px]' />
          ) : selectedPath ? (
            <MarkdownView content={content} />
          ) : (
            <div className='flex h-full items-center justify-center'>
              <div className='flex max-w-sm flex-col items-center gap-3 text-center'>
                <DatabaseIcon className='size-8 text-muted-foreground' strokeWidth={1.5} />
                <p className='text-[13px] leading-relaxed text-muted-foreground'>
                  Browse <code className='font-mono text-foreground/80'>{projectWorkdir}/knowledge/</code>. Pick a file on the left, or create a new one.
                </p>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

function IconButton({ children, title, onClick, disabled }: {
  children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean
}) {
  return (
    <button
      type='button' title={title} onClick={onClick} disabled={disabled}
      className='inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:opacity-50'
    >
      {children}
    </button>
  )
}

function ToolbarButton({ children, onClick, tone, disabled }: {
  children: React.ReactNode; onClick: () => void; tone?: 'gold' | 'danger'; disabled?: boolean
}) {
  return (
    <button
      type='button' onClick={onClick} disabled={disabled}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] font-medium transition-colors disabled:opacity-50',
        tone === 'gold'
          ? 'border-transparent bg-[var(--anubis-gold)] text-[#0B0C0F] hover:bg-[var(--anubis-gold-deep)]'
          : tone === 'danger'
            ? 'border-border text-destructive hover:bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)]'
            : 'border-border bg-card text-foreground hover:bg-card/70',
      )}
    >
      {children}
    </button>
  )
}

function SearchResults({ results, onClear, onOpen }: {
  results: KnowledgeBaseSearchHit[]; onClear: () => void; onOpen: (path: string) => void
}) {
  return (
    <div className='px-2'>
      <button type='button' onClick={onClear} className='mb-1 px-1 text-[11px] text-muted-foreground hover:text-foreground'>
        ← back to files
      </button>
      {results.length === 0 ? (
        <p className='px-1 py-1 text-[12px] text-muted-foreground'>No results.</p>
      ) : (
        <ul className='flex flex-col gap-1'>
          {results.map((h, i) => (
            <li key={`${h.source}-${h.startLine}-${i}`}>
              <button type='button' onClick={() => onOpen(h.source)} className='w-full rounded px-1.5 py-1 text-left hover:bg-background'>
                <span className='block truncate font-mono text-[11.5px] text-foreground/80'>{h.source}</span>
                {h.heading && <span className='block truncate text-[11px] text-muted-foreground'>{h.heading}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
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
