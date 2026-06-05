import cron from 'node-cron'
import chokidar from 'chokidar'
import {
  WorkflowGraphSchema,
  scheduleTriggerExecutor,
  fileWatchTriggerExecutor,
  type ScheduleTriggerConfig,
  type FileWatchTriggerConfig,
} from '@anubis/workflow-runtime'
import type { ConversationStack } from '@anubis/conversation'
import type { WorkflowRunManager } from './workflow-run-manager.js'

const TRIGGER_TYPES = new Set(['scheduleTrigger', 'fileWatchTrigger'])

interface TriggerHandle { stop(): void }

function badRequest(message: string): Error {
  const err = new Error(message)
  ;(err as { code?: number }).code = 400
  return err
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Simple `*`-glob matched against the file's basename. Exported for tests. */
export function matchesGlob(filePath: string, glob?: string): boolean {
  if (!glob || !glob.trim()) return true
  const base = filePath.split(/[\\/]/).pop() ?? filePath
  const re = new RegExp('^' + glob.trim().split('*').map(escapeRegex).join('.*') + '$')
  return re.test(base)
}

export class TriggerManager {
  private armed = new Map<string, TriggerHandle>()

  constructor(
    private stack: ConversationStack,
    private runManager: WorkflowRunManager,
  ) {}

  isArmed(workflowId: string): boolean {
    return this.armed.has(workflowId)
  }

  arm(workflowId: string): void {
    if (this.armed.has(workflowId)) return
    const wf = this.stack.workflows.get(workflowId)
    if (!wf) throw badRequest(`workflow ${workflowId} not found`)
    if (!wf.publishedGraph) throw badRequest('workflow has no published version')
    const graph = WorkflowGraphSchema.parse(JSON.parse(wf.publishedGraph))
    const triggers = graph.nodes.filter((n) => TRIGGER_TYPES.has(n.type))
    if (triggers.length !== 1) {
      throw badRequest('workflow must contain exactly one trigger node to arm')
    }
    const node = triggers[0]!
    const handle = node.type === 'scheduleTrigger'
      ? this.armSchedule(workflowId, node.id, scheduleTriggerExecutor.validateConfig(node.data))
      : this.armFileWatch(workflowId, node.id, fileWatchTriggerExecutor.validateConfig(node.data))
    this.armed.set(workflowId, handle)
    this.stack.workflowTriggers.setArmed(workflowId, true, Date.now())
  }

  disarm(workflowId: string): void {
    const handle = this.armed.get(workflowId)
    if (handle) {
      handle.stop()
      this.armed.delete(workflowId)
    }
    this.stack.workflowTriggers.setArmed(workflowId, false, null)
  }

  rearmAll(): void {
    for (const row of this.stack.workflowTriggers.listArmed()) {
      try {
        this.arm(row.workflowId)
      } catch (err) {
        console.error('[trigger] rearm failed for', row.workflowId, err)
        // Clear the stale armed flag so we do not retry forever.
        this.stack.workflowTriggers.setArmed(row.workflowId, false, null)
      }
    }
  }

  shutdown(): void {
    for (const handle of this.armed.values()) handle.stop()
    this.armed.clear()
  }

  private fire(workflowId: string, nodeId: string, payload: unknown): void {
    // Respect the one-active-run-per-workflow guard: drop overlapping fires.
    if (this.runManager.activeRunFor(workflowId)) {
      console.warn('[trigger] skip fire — run already active for', workflowId)
      return
    }
    void this.runManager.start(workflowId, { nodeId, payload }).catch((err) => {
      console.error('[trigger] failed to start run for', workflowId, err)
    })
  }

  private armSchedule(workflowId: string, nodeId: string, cfg: ScheduleTriggerConfig): TriggerHandle {
    const fireNow = () =>
      this.fire(workflowId, nodeId, { kind: 'trigger', event: 'schedule', firedAt: Date.now() })

    if (cfg.cron && cfg.cron.trim()) {
      if (!cron.validate(cfg.cron)) throw badRequest(`invalid cron expression: ${cfg.cron}`)
      const task = cron.schedule(cfg.cron, fireNow)
      return { stop: () => task.stop() }
    }
    const ms = cfg.everyUnit === 'hour' ? cfg.everyValue * 3_600_000 : cfg.everyValue * 60_000
    const handle = setInterval(fireNow, ms)
    handle.unref?.()
    return { stop: () => clearInterval(handle) }
  }

  private armFileWatch(workflowId: string, nodeId: string, cfg: FileWatchTriggerConfig): TriggerHandle {
    const watcher = chokidar.watch(cfg.path, {
      ignoreInitial: true,
      depth: cfg.watchKind === 'folder' ? undefined : 0,
    })
    const debouncers = new Map<string, ReturnType<typeof setTimeout>>()

    const onEvent = (event: 'add' | 'change' | 'unlink', changedPath: string) => {
      if (!matchesGlob(changedPath, cfg.glob)) return
      const key = `${event}:${changedPath}`
      const existing = debouncers.get(key)
      if (existing) clearTimeout(existing)
      debouncers.set(key, setTimeout(() => {
        debouncers.delete(key)
        this.fire(workflowId, nodeId, { kind: 'trigger', event: 'file', path: changedPath, eventType: event })
      }, 300))
    }

    for (const ev of cfg.events) watcher.on(ev, (p: string) => onEvent(ev, p))

    return {
      stop: () => {
        for (const t of debouncers.values()) clearTimeout(t)
        debouncers.clear()
        void watcher.close()
      },
    }
  }
}
