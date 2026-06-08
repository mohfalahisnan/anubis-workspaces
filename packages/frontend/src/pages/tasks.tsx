import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  BotIcon,
  FileTextIcon,
  FolderOpenIcon,
  ListFilterIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  WorkflowIcon,
  XIcon,
} from 'lucide-react'
import type { ProfileSummary } from '@anubis/shared'
import {
  createTask,
  deleteTask,
  listProfiles,
  listTasks,
  updateTask,
  type TaskPriority,
  type TaskStatus,
  type TaskSummary,
} from '@/api'
import { workflowsApi, type WorkflowSummary } from '@/api/workflows'
import { Button } from '@/components/ui/button'
import { KanbanBoard, type KanbanColumn } from '@/components/kanban'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useProject } from '@/lib/use-project'
import { cn } from '@/lib/utils'

const TASK_STATUSES: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'in_review', 'done']
const TASK_PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent']

const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
}

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
}

const PRIORITY_TONE: Record<TaskPriority, string> = {
  low: 'border-border bg-muted/30 text-muted-foreground',
  medium: 'border-[#4E6E8E]/45 bg-[#4E6E8E]/15 text-[#9db8d2]',
  high: 'border-[var(--anubis-gold)]/45 bg-[var(--anubis-gold)]/12 text-[var(--anubis-gold)]',
  urgent: 'border-destructive/45 bg-destructive/10 text-destructive',
}

interface DraftTask {
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  assigneeProfileId: string
  fileReferences: string[]
  workflowReferences: string[]
}

function emptyDraft(): DraftTask {
  return {
    title: '',
    description: '',
    status: 'backlog',
    priority: 'medium',
    assigneeProfileId: UNASSIGNED,
    fileReferences: [],
    workflowReferences: [],
  }
}

const UNASSIGNED = '__unassigned__'

export function TasksPage() {
  const { activeProject } = useProject()
  const [items, setItems] = useState<TaskSummary[]>([])
  const [profiles, setProfiles] = useState<ProfileSummary[]>([])
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selected = items.find((item) => item.id === selectedId) ?? null

  async function refresh() {
    setBusy(true)
    setError(null)
    try {
      const [nextTasks, nextProfiles, nextWorkflows] = await Promise.all([
        listTasks({ projectId: activeProject?.id || undefined, limit: 300 }),
        listProfiles(),
        workflowsApi.list(activeProject?.id),
      ])
      setItems(nextTasks)
      setProfiles(nextProfiles)
      setWorkflows(nextWorkflows.items)
      if (selectedId && !nextTasks.some((item) => item.id === selectedId)) setSelectedId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id])

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    const profileName = new Map(profiles.map((profile) => [profile.id, profile.name]))
    const workflowName = new Map(workflows.map((workflow) => [workflow.id, workflow.name]))
    return items.filter((item) => {
      const haystack = [
        item.title,
        item.description,
        item.priority,
        item.status,
        item.assigneeProfileId ? profileName.get(item.assigneeProfileId) : undefined,
        ...item.fileReferences,
        ...item.workflowReferences.map((id) => workflowName.get(id) ?? id),
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }, [items, profiles, query, workflows])

  const counts = useMemo(() => {
    const out = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])) as Record<TaskStatus, number>
    for (const item of items) out[item.status] += 1
    return out
  }, [items])

  const columns = useMemo<Array<KanbanColumn<TaskStatus, TaskSummary>>>(() => (
    TASK_STATUSES.map((status) => ({
      id: status,
      label: STATUS_LABEL[status],
      items: filteredItems.filter((item) => item.status === status),
      count: counts[status],
      emptyLabel: 'Empty',
    }))
  ), [counts, filteredItems])

  async function moveTask(id: string, status: TaskStatus) {
    const current = items.find((item) => item.id === id)
    if (!current || current.status === status) return
    setItems((prev) => prev.map((item) => item.id === id ? { ...item, status, updatedAt: Date.now() } : item))
    try {
      const saved = await updateTask(id, { status })
      setItems((prev) => prev.map((item) => item.id === saved.id ? saved : item))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      await refresh()
    }
  }

  async function removeTask(id: string) {
    if (!confirm('Delete this task?')) return
    await deleteTask(id)
    setItems((prev) => prev.filter((item) => item.id !== id))
    setSelectedId(null)
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-hidden bg-background'>
      <div className='border-b border-border px-6 py-4'>
        <div className='flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between'>
          <div>
            <h1 className='text-[24px] font-semibold tracking-[-0.02em]'>Tasks</h1>
            <p className='mt-1 text-[13px] text-muted-foreground'>
              {activeProject?.name ?? 'Default Project'}
            </p>
          </div>
          <div className='flex items-center gap-2'>
            <Button variant='secondary' onClick={() => void refresh()} disabled={busy}>
              <ListFilterIcon className={cn('size-4', busy && 'animate-pulse')} />
              Refresh
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <PlusIcon className='size-4' />
              New task
            </Button>
          </div>
        </div>
      </div>

      <div className='flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/15 px-6 py-3'>
        <label className='flex h-9 w-80 max-w-full items-center gap-2 rounded-md border border-border bg-background px-2.5 text-muted-foreground focus-within:border-[var(--anubis-gold)]/60'>
          <SearchIcon className='size-4' />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Search tasks...'
            className='min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground'
          />
        </label>
        <div className='flex flex-wrap gap-1.5'>
          {TASK_PRIORITIES.map((priority) => (
            <span key={priority} className={cn('rounded-md border px-2 py-1 text-[11px] font-medium', PRIORITY_TONE[priority])}>
              {PRIORITY_LABEL[priority]}
            </span>
          ))}
        </div>
      </div>

      {error ? (
        <div className='border-b border-destructive/30 bg-destructive/10 px-6 py-2 text-[13px] text-destructive'>
          {error}
        </div>
      ) : null}

      <KanbanBoard
        columns={columns}
        getItemId={(task) => task.id}
        onMove={moveTask}
        renderItem={(task) => (
          <TaskCard
            task={task}
            profile={profiles.find((profile) => profile.id === task.assigneeProfileId)}
            workflowNames={workflowNames(task.workflowReferences, workflows)}
            onOpen={() => setSelectedId(task.id)}
          />
        )}
      />

      <TaskDialog
        open={createOpen}
        title='New task'
        profiles={profiles}
        workflows={workflows}
        initial={emptyDraft()}
        submitLabel='Create'
        onClose={() => setCreateOpen(false)}
        onSubmit={async (draft) => {
          const created = await createTask({
            projectId: activeProject?.id,
            title: draft.title.trim(),
            description: draft.description.trim() || undefined,
            status: draft.status,
            priority: draft.priority,
            assigneeProfileId: draft.assigneeProfileId === UNASSIGNED ? undefined : draft.assigneeProfileId,
            fileReferences: draft.fileReferences,
            workflowReferences: draft.workflowReferences,
          })
          setItems((prev) => [created, ...prev])
          setCreateOpen(false)
        }}
      />

      {selected ? (
        <TaskDialog
          open={Boolean(selected)}
          title='Edit task'
          profiles={profiles}
          workflows={workflows}
          initial={draftFromTask(selected)}
          submitLabel='Save'
          destructiveAction={
            <Button variant='destructive' onClick={() => void removeTask(selected.id)}>
              <Trash2Icon className='size-4' />
              Delete
            </Button>
          }
          onClose={() => setSelectedId(null)}
          onSubmit={async (draft) => {
            const saved = await updateTask(selected.id, {
              title: draft.title.trim(),
              description: draft.description.trim() || null,
              status: draft.status,
              priority: draft.priority,
              assigneeProfileId: draft.assigneeProfileId === UNASSIGNED ? null : draft.assigneeProfileId,
              fileReferences: draft.fileReferences,
              workflowReferences: draft.workflowReferences,
            })
            setItems((prev) => prev.map((item) => item.id === saved.id ? saved : item))
            setSelectedId(null)
          }}
        />
      ) : null}
    </div>
  )
}

function TaskCard({
  task,
  profile,
  workflowNames,
  onOpen,
}: {
  task: TaskSummary
  profile?: ProfileSummary
  workflowNames: string[]
  onOpen: () => void
}) {
  return (
    <button
      type='button'
      onClick={onOpen}
      className='group w-full cursor-grab rounded-md border border-border bg-card p-3 text-left transition-colors hover:border-[var(--anubis-gold)] hover:bg-muted/30 active:cursor-grabbing'
    >
      <div className='flex items-start justify-between gap-2'>
        <p className='line-clamp-2 min-w-0 text-[13px] font-medium leading-snug text-foreground group-hover:text-[var(--anubis-gold)]'>
          {task.title}
        </p>
        <span className={cn('shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium', PRIORITY_TONE[task.priority])}>
          {PRIORITY_LABEL[task.priority]}
        </span>
      </div>
      {task.description ? (
        <p className='mt-2 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground'>
          {task.description}
        </p>
      ) : null}
      <div className='mt-3 flex flex-wrap gap-1.5 text-[10.5px] text-muted-foreground'>
        <span className='inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5'>
          <BotIcon className='size-3 shrink-0' />
          <span className='truncate'>{profile?.name ?? 'Unassigned'}</span>
        </span>
        <span className='inline-flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5'>
          <FileTextIcon className='size-3' />
          {task.fileReferences.length}
        </span>
        <span className='inline-flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5'>
          <WorkflowIcon className='size-3' />
          {workflowNames.length}
        </span>
      </div>
      {workflowNames.length > 0 ? (
        <p className='mt-2 truncate text-[11px] text-muted-foreground'>{workflowNames.join(', ')}</p>
      ) : null}
    </button>
  )
}

function TaskDialog({
  open,
  title,
  initial,
  profiles,
  workflows,
  submitLabel,
  destructiveAction,
  onClose,
  onSubmit,
}: {
  open: boolean
  title: string
  initial: DraftTask
  profiles: ProfileSummary[]
  workflows: WorkflowSummary[]
  submitLabel: string
  destructiveAction?: ReactNode
  onClose: () => void
  onSubmit: (draft: DraftTask) => Promise<void>
}) {
  const [draft, setDraft] = useState<DraftTask>(initial)
  const [busy, setBusy] = useState(false)
  const [filePickerUnavailable, setFilePickerUnavailable] = useState(false)

  useEffect(() => {
    if (open) setDraft(initial)
  }, [initial, open])

  async function submit() {
    if (!draft.title.trim()) return
    setBusy(true)
    try {
      await onSubmit(draft)
    } finally {
      setBusy(false)
    }
  }

  async function addFiles() {
    if (typeof window === 'undefined' || !window.anubis?.files) {
      setFilePickerUnavailable(true)
      return
    }
    const picked = await window.anubis.files.pick()
    if (picked.length === 0) return
    setFilePickerUnavailable(false)
    setDraft((current) => ({
      ...current,
      fileReferences: uniqueStrings([...current.fileReferences, ...picked]),
    }))
  }

  function removeFile(path: string) {
    setDraft((current) => ({
      ...current,
      fileReferences: current.fileReferences.filter((item) => item !== path),
    }))
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent aria-describedby={undefined} className='max-h-[90vh] overflow-y-auto sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className='grid gap-4'>
          <label className='grid gap-1.5'>
            <span className='text-[12px] font-medium text-muted-foreground'>Title</span>
            <Input
              value={draft.title}
              onChange={(e) => setDraft((current) => ({ ...current, title: e.target.value }))}
              autoFocus
            />
          </label>
          <label className='grid gap-1.5'>
            <span className='text-[12px] font-medium text-muted-foreground'>Description</span>
            <Textarea
              value={draft.description}
              onChange={(e) => setDraft((current) => ({ ...current, description: e.target.value }))}
              rows={4}
            />
          </label>
          <div className='grid gap-3 md:grid-cols-3'>
            <Field label='Status'>
              <Select value={draft.status} onValueChange={(value) => setDraft((current) => ({ ...current, status: value as TaskStatus }))}>
                <SelectTrigger className='w-full'><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>{STATUS_LABEL[status]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label='Priority'>
              <Select value={draft.priority} onValueChange={(value) => setDraft((current) => ({ ...current, priority: value as TaskPriority }))}>
                <SelectTrigger className='w-full'><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_PRIORITIES.map((priority) => (
                    <SelectItem key={priority} value={priority}>{PRIORITY_LABEL[priority]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label='Assignee'>
              <Select
                value={draft.assigneeProfileId}
                onValueChange={(value) => setDraft((current) => ({ ...current, assigneeProfileId: value }))}
              >
                <SelectTrigger className='w-full'><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className='grid gap-2'>
            <div className='flex items-center justify-between gap-3'>
              <span className='text-[12px] font-medium text-muted-foreground'>File references</span>
              <Button type='button' variant='secondary' onClick={() => void addFiles()}>
                <FolderOpenIcon className='size-4' />
                Add files
              </Button>
            </div>
            <div className='grid min-h-16 gap-2 rounded-md border border-border bg-background p-2'>
              {draft.fileReferences.length === 0 ? (
                <p className='px-1 py-2 text-[12px] text-muted-foreground'>No files selected.</p>
              ) : draft.fileReferences.map((path) => (
                <div key={path} className='flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5'>
                  <FileTextIcon className='size-3.5 shrink-0 text-muted-foreground' />
                  <span className='min-w-0 flex-1 truncate font-mono text-[11.5px]' title={path}>{path}</span>
                  <button
                    type='button'
                    aria-label='Remove file reference'
                    onClick={() => removeFile(path)}
                    className='flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground'
                  >
                    <XIcon className='size-3.5' />
                  </button>
                </div>
              ))}
            </div>
            {filePickerUnavailable ? (
              <p className='text-[12px] text-muted-foreground'>File explorer is available in the desktop app.</p>
            ) : null}
          </div>
          <div className='grid gap-2'>
            <span className='text-[12px] font-medium text-muted-foreground'>Workflow references</span>
            <div className='grid max-h-48 gap-2 overflow-y-auto rounded-md border border-border bg-background p-2'>
              {workflows.length === 0 ? (
                <p className='px-1 py-2 text-[12px] text-muted-foreground'>No workflows in this project.</p>
              ) : workflows.map((workflow) => {
                const checked = draft.workflowReferences.includes(workflow.id)
                return (
                  <label key={workflow.id} className='flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted'>
                    <input
                      type='checkbox'
                      checked={checked}
                      onChange={(e) => {
                        setDraft((current) => ({
                          ...current,
                          workflowReferences: e.target.checked
                            ? [...current.workflowReferences, workflow.id]
                            : current.workflowReferences.filter((id) => id !== workflow.id),
                        }))
                      }}
                    />
                    <span className='min-w-0 flex-1 truncate text-[13px]'>{workflow.name}</span>
                  </label>
                )
              })}
            </div>
          </div>
        </div>
        <DialogFooter className='items-center justify-between sm:justify-between'>
          <div>{destructiveAction}</div>
          <div className='flex gap-2'>
            <Button variant='ghost' onClick={onClose}>Cancel</Button>
            <Button onClick={() => void submit()} disabled={busy || !draft.title.trim()}>{submitLabel}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className='grid gap-1.5'>
      <span className='text-[12px] font-medium text-muted-foreground'>{label}</span>
      {children}
    </label>
  )
}

function draftFromTask(task: TaskSummary): DraftTask {
  return {
    title: task.title,
    description: task.description ?? '',
    status: task.status,
    priority: task.priority,
    assigneeProfileId: task.assigneeProfileId ?? UNASSIGNED,
    fileReferences: task.fileReferences,
    workflowReferences: task.workflowReferences,
  }
}

function workflowNames(ids: string[], workflows: WorkflowSummary[]): string[] {
  const byId = new Map(workflows.map((workflow) => [workflow.id, workflow.name]))
  return ids.map((id) => byId.get(id) ?? id)
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}
