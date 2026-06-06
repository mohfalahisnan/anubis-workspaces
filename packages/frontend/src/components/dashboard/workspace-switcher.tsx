import { useState } from 'react'
import { CheckIcon, ChevronsUpDownIcon, PlusIcon, PencilIcon, ArchiveIcon } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useActiveWorkspace, DEFAULT_WORKSPACE_ID } from '@/lib/workspace'

type DialogMode = { kind: 'create' } | { kind: 'rename'; id: string; name: string } | null

export function WorkspaceSwitcher() {
  const { workspaces, activeWorkspace, activeWorkspaceId, setActiveWorkspace, create, rename, archive } =
    useActiveWorkspace()
  const [dialog, setDialog] = useState<DialogMode>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  function openCreate() { setName(''); setDialog({ kind: 'create' }) }
  function openRename(id: string, current: string) { setName(current); setDialog({ kind: 'rename', id, name: current }) }

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed || !dialog) return
    setBusy(true)
    try {
      if (dialog.kind === 'create') await create({ name: trimmed })
      else await rename(dialog.id, trimmed)
      setDialog(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex h-9 max-w-[220px] items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <span className="truncate">{activeWorkspace?.name ?? 'Workspace'}</span>
            <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {workspaces.map((w) => (
            <DropdownMenuItem
              key={w.id}
              onSelect={() => setActiveWorkspace(w.id)}
              className="group flex items-center gap-2"
            >
              <CheckIcon className={cn('size-3.5', w.id === activeWorkspaceId ? 'opacity-100' : 'opacity-0')} />
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
              <button
                type="button"
                aria-label="Rename workspace"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); openRename(w.id, w.name) }}
                className="opacity-0 transition-opacity group-hover:opacity-100"
              >
                <PencilIcon className="size-3.5 text-muted-foreground hover:text-foreground" />
              </button>
              {w.id !== DEFAULT_WORKSPACE_ID && (
                <button
                  type="button"
                  aria-label="Archive workspace"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); void archive(w.id) }}
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <ArchiveIcon className="size-3.5 text-muted-foreground hover:text-destructive" />
                </button>
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => openCreate()} className="gap-2">
            <PlusIcon className="size-3.5" />
            New workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog?.kind === 'rename' ? 'Rename workspace' : 'New workspace'}</DialogTitle>
          </DialogHeader>
          <Input
            value={name}
            autoFocus
            placeholder="Workspace name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)} disabled={busy}>Cancel</Button>
            <Button onClick={() => void submit()} disabled={busy || !name.trim()}>
              {dialog?.kind === 'rename' ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
