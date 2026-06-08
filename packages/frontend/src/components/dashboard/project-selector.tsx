import { useState } from 'react'
import {
  ChevronDown,
  Check,
  Plus,
  Folder,
  Trash2,
  X,
  Sparkles,
} from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useProject } from '@/lib/use-project'
import { cn } from '@/lib/utils'
import type { ProjectSummary } from '@anubis/shared'

const PRESET_EMOJIS = ['🎯', '🚀', '🧪', '📁', '💼', '🎨', '🔥', '🤖', '⚡', '📊']

async function pickFolder(): Promise<string | null> {
  if (typeof window !== 'undefined' && window.anubis?.workspace) {
    return window.anubis.workspace.pick()
  }
  // Browser dev fallback
  const typed = window.prompt('Working directory (absolute path):')
  return typed && typed.trim() ? typed.trim() : null
}

export function ProjectSelector() {
  const {
    projects,
    activeProject,
    setActiveProjectId,
    createProject,
    deleteProject,
  } = useProject()

  const [open, setOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  
  // Form state
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('🎯')
  const [workdir, setWorkdir] = useState('')
  const [color, setColor] = useState('#d9a441')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Project name is required')
      return
    }
    setError('')
    setLoading(true)
    try {
      await createProject({
        name: name.trim(),
        emoji: emoji || '🎯',
        workdir: workdir.trim() || undefined,
        color,
      })
      // Reset form
      setName('')
      setEmoji(PRESET_EMOJIS[Math.floor(Math.random() * PRESET_EMOJIS.length)])
      setWorkdir('')
      setIsCreating(false)
      setOpen(false)
    } catch (err: any) {
      setError(err?.message || 'Failed to create project')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (id === 'default') return
    if (!window.confirm('Are you sure you want to delete this project? Data scoped under it will be preserved but inaccessible.')) {
      return
    }
    try {
      await deleteProject(id)
    } catch (err: any) {
      alert(err?.message || 'Failed to delete project')
    }
  }

  const handleBrowse = async () => {
    const picked = await pickFolder()
    if (picked) {
      setWorkdir(picked)
    }
  }

  return (
    <div className="px-2 pb-2">
      <Popover open={open} onOpenChange={(v) => {
        setOpen(v)
        if (!v) {
          setIsCreating(false)
          setError('')
        }
      }}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2.5 rounded-lg border border-sidebar-border bg-sidebar-accent/50 px-3 py-2.5 text-left transition-all hover:bg-sidebar-accent hover:border-sidebar-border/80 focus:outline-none"
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="text-lg shrink-0 leading-none" role="img" aria-label="project emoji">
                {activeProject?.emoji || '📁'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground leading-snug">
                  {activeProject?.name || 'Default Project'}
                </div>
                {activeProject?.workdir && (
                  <div className="truncate font-mono text-[10px] text-muted-foreground leading-none mt-0.5">
                    {activeProject.workdir}
                  </div>
                )}
              </div>
            </div>
            <ChevronDown className="size-4 text-muted-foreground shrink-0 transition-transform duration-200" />
          </button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          sideOffset={6}
          className="z-50 w-72 rounded-xl border border-border bg-popover p-2 shadow-xl outline-none"
        >
          {!isCreating ? (
            <div className="flex flex-col">
              <div className="px-2 py-1.5 text-[11px] font-mono uppercase tracking-[0.1em] text-muted-foreground/70 border-b border-border/40 mb-1">
                Projects
              </div>

              <div className="max-h-60 overflow-y-auto py-0.5 flex flex-col gap-0.5">
                {projects.map((p) => {
                  const isSelected = p.id === activeProject?.id
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setActiveProjectId(p.id)
                        setOpen(false)
                      }}
                      className={cn(
                        'group flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm transition-all',
                        isSelected
                          ? 'bg-muted text-foreground font-medium'
                          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                      )}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="text-base shrink-0 leading-none">
                          {p.emoji || '📁'}
                        </span>
                        <div className="min-w-0 flex-1">
                          <span className="block truncate">{p.name}</span>
                          {p.workdir && (
                            <span className="block truncate font-mono text-[9.5px] text-muted-foreground/70 mt-0.5">
                              {p.workdir}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        {p.color && (
                          <span
                            className="size-1.5 rounded-full"
                            style={{ backgroundColor: p.color }}
                          />
                        )}
                        {isSelected && (
                          <Check className="size-3.5 text-[var(--anubis-gold)] shrink-0" strokeWidth={3} />
                        )}
                        {p.id !== 'default' && (
                          <button
                            type="button"
                            onClick={(e) => handleDelete(e, p.id)}
                            className="text-muted-foreground/50 hover:text-destructive opacity-0 group-hover:opacity-100 p-0.5 rounded transition-opacity duration-150"
                            title="Delete project"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>

              <button
                type="button"
                onClick={() => setIsCreating(true)}
                className="mt-1.5 flex w-full items-center gap-2 rounded-lg border border-dashed border-border/80 px-2.5 py-2 text-left text-sm text-foreground/80 hover:bg-muted/50 hover:border-border transition-all"
              >
                <Plus className="size-4 text-muted-foreground" />
                <span className="font-medium">New Project</span>
              </button>
            </div>
          ) : (
            <form onSubmit={handleCreate} className="flex flex-col gap-3 p-1">
              <div className="flex items-center justify-between border-b border-border/40 pb-1.5 mb-0.5">
                <span className="text-xs font-semibold text-foreground/90 flex items-center gap-1">
                  <Sparkles className="size-3.5 text-[var(--anubis-gold)]" />
                  Create Project
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setIsCreating(false)
                    setError('')
                  }}
                  className="rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </div>

              {error && (
                <div className="rounded bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
                  {error}
                </div>
              )}

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  Project Name
                </label>
                <Input
                  required
                  placeholder="e.g. My Brand"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-8 bg-muted/30 border-border/70 focus-visible:border-ring"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  Emoji & Theme Color
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="🎯"
                    value={emoji}
                    onChange={(e) => setEmoji(e.target.value)}
                    className="h-8 w-12 text-center text-base p-0 bg-muted/30 border-border/70"
                    maxLength={4}
                  />
                  <div className="flex flex-wrap gap-1 flex-1">
                    {PRESET_EMOJIS.slice(0, 5).map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => setEmoji(e)}
                        className={cn(
                          "size-7 flex items-center justify-center rounded-md text-sm transition-all hover:bg-muted",
                          emoji === e && "bg-muted border border-border"
                        )}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="size-7 shrink-0 cursor-pointer rounded-md border border-border/70 bg-transparent p-0 overflow-hidden"
                    title="Choose theme color"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  Working Directory (Optional)
                </label>
                <div className="flex gap-1.5">
                  <Input
                    placeholder="e.g. C:\Projects\MyBrand"
                    value={workdir}
                    onChange={(e) => setWorkdir(e.target.value)}
                    className="h-8 flex-1 bg-muted/30 border-border/70 font-mono text-[11px]"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleBrowse}
                    className="h-8 px-2 bg-muted/30 border-border/70"
                    title="Browse folders"
                  >
                    <Folder className="size-3.5" />
                  </Button>
                </div>
                <span className="text-[9.5px] text-muted-foreground/80 leading-normal">
                  Agent file tasks will run inside this path.
                </span>
              </div>

              <div className="flex justify-end gap-1.5 pt-1 border-t border-border/40 mt-1">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setIsCreating(false)
                    setError('')
                  }}
                  className="h-8 px-3 text-xs"
                  disabled={loading}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="h-8 px-3 text-xs bg-[var(--anubis-gold)] hover:bg-[var(--anubis-gold-deep)] text-black font-semibold"
                  disabled={loading}
                >
                  {loading ? 'Creating...' : 'Create'}
                </Button>
              </div>
            </form>
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}
