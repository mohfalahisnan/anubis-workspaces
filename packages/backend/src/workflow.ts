import { Hono } from 'hono'
import { z, ZodError } from 'zod'
import { randomUUID } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { resolve, sep, join, extname } from 'node:path'
import { getStack, getDataDir } from './services.js'
import { WorkflowGraphSchema } from '@anubis/workflow-runtime'
import { WorkflowRunManager } from './workflow-run-manager.js'
import { TriggerManager } from './trigger-manager.js'
import type { ConversationStack } from '@anubis/conversation'

const ARTIFACT_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
}

let runManager: WorkflowRunManager | null = null
function getRunManager(stack: ConversationStack): WorkflowRunManager {
  if (!runManager) runManager = new WorkflowRunManager(stack, getDataDir())
  return runManager
}

let triggerManager: TriggerManager | null = null
function getTriggerManager(stack: ConversationStack): TriggerManager {
  if (!triggerManager) triggerManager = new TriggerManager(stack, getRunManager(stack))
  return triggerManager
}

const TRIGGER_TYPES = new Set(['scheduleTrigger', 'fileWatchTrigger'])
function graphHasTrigger(graphJson?: string | null): boolean {
  if (!graphJson) return false
  try {
    const g = JSON.parse(graphJson) as { nodes?: Array<{ type?: string }> }
    return Array.isArray(g.nodes) && g.nodes.some((n) => n.type != null && TRIGGER_TYPES.has(n.type))
  } catch {
    return false
  }
}

/** Called once at backend boot to restore armed triggers. */
export function rearmTriggersOnBoot(stack: ConversationStack): void {
  getTriggerManager(stack).rearmAll()
}

/** Called at backend shutdown to tear down timers/watchers. */
export function shutdownTriggers(): void {
  if (triggerManager) {
    triggerManager.shutdown()
    triggerManager = null
  }
}

const CreateBody = z.object({
  name: z.string().min(1),
  projectId: z.string().min(1).optional(),
  description: z.string().optional(),
})

const PatchMetaBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
})

const DraftBody = z.object({ draftGraph: z.string().min(2) })
const RunBody = z.object({
  nodeDataOverrides: z.record(z.string(), z.unknown()).optional(),
}).strict()

/** Versioned envelope for a portable workflow file. */
const EXPORT_VERSION = 1
const ImportBody = z.object({
  anubisWorkflowExport: z.literal(EXPORT_VERSION).optional(),
  name: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  graph: WorkflowGraphSchema,
})

export const workflowRoutes = new Hono()

workflowRoutes.post('/', async (c) => {
  const body = CreateBody.parse(await c.req.json())
  const stack = getStack()
  const now = Date.now()
  const wf = stack.workflows.create({ id: randomUUID(), name: body.name, projectId: body.projectId, description: body.description, now })
  return c.json(wf, 201)
})

workflowRoutes.post('/import', async (c) => {
  const body = ImportBody.parse(await c.req.json())
  const stack = getStack()
  const wf = stack.workflows.importGraph({
    id: randomUUID(),
    name: body.name?.trim() || 'Imported workflow',
    projectId: body.projectId,
    description: body.description ?? undefined,
    draftGraph: JSON.stringify(body.graph),
    now: Date.now(),
  })
  return c.json(wf, 201)
})

workflowRoutes.get('/', (c) => {
  const stack = getStack()
  const projectId = c.req.query('projectId')
  const items = stack.workflows.list(projectId).map((wf) => {
    const lastRun = stack.workflowRuns.listRunsForWorkflow(wf.id, 1)[0]
    return {
      id: wf.id, name: wf.name, description: wf.description,
      projectId: wf.projectId,
      hasPublished: wf.publishedGraph != null,
      draftAhead: wf.publishedGraph != null && wf.draftGraph !== wf.publishedGraph,
      draftUpdatedAt: wf.draftUpdatedAt, publishedAt: wf.publishedAt,
      lastRun: lastRun ? { id: lastRun.id, status: lastRun.status, startedAt: lastRun.startedAt } : undefined,
      previewGraph: wf.draftGraph,
      hasTrigger: graphHasTrigger(wf.publishedGraph),
      armed: getTriggerManager(stack).isArmed(wf.id),
    }
  })
  return c.json({ items })
})

workflowRoutes.get('/artifacts', (c) => {
  const requested = c.req.query('path')
  if (!requested) return c.json({ error: 'missing_path' }, 400)
  const root = resolve(join(getDataDir(), 'workflow-runs'))
  const target = resolve(requested)
  // Allow only paths under {dataDir}/workflow-runs/ with no `..` escape.
  if (!target.startsWith(root + sep) && target !== root) {
    return c.json({ error: 'forbidden' }, 403)
  }
  if (!existsSync(target)) return c.json({ error: 'not_found' }, 404)
  const stream = createReadStream(target)
  const contentType = ARTIFACT_MIME[extname(target).toLowerCase()] ?? 'application/octet-stream'
  return c.body(stream as unknown as ReadableStream, 200, {
    'Content-Type': contentType,
    'Cache-Control': 'private, max-age=300',
  })
})

workflowRoutes.get('/:id/export', (c) => {
  const stack = getStack()
  const wf = stack.workflows.get(c.req.param('id'))
  if (!wf) return c.json({ error: 'not_found' }, 404)
  return c.json({
    anubisWorkflowExport: EXPORT_VERSION,
    exportedAt: Date.now(),
    name: wf.name,
    description: wf.description,
    graph: JSON.parse(wf.draftGraph),
  })
})

workflowRoutes.get('/:id', (c) => {
  const stack = getStack()
  const wf = stack.workflows.get(c.req.param('id'))
  if (!wf) return c.json({ error: 'not_found' }, 404)
  return c.json({
    ...wf,
    hasTrigger: graphHasTrigger(wf.publishedGraph),
    armed: getTriggerManager(stack).isArmed(wf.id),
  })
})

workflowRoutes.patch('/:id', async (c) => {
  const stack = getStack()
  const body = PatchMetaBody.parse(await c.req.json())
  const wf = stack.workflows.updateMeta(c.req.param('id'), body, Date.now())
  return c.json(wf)
})

workflowRoutes.put('/:id/draft', async (c) => {
  const stack = getStack()
  const body = DraftBody.parse(await c.req.json())
  WorkflowGraphSchema.parse(JSON.parse(body.draftGraph))
  const wf = stack.workflows.writeDraft(c.req.param('id'), body.draftGraph, Date.now())
  return c.json(wf)
})

workflowRoutes.post('/:id/publish', (c) => {
  const stack = getStack()
  const wf = stack.workflows.publish(c.req.param('id'), Date.now())
  return c.json(wf)
})

workflowRoutes.post('/:id/arm', (c) => {
  const stack = getStack()
  try {
    getTriggerManager(stack).arm(c.req.param('id'))
    return c.json({ armed: true })
  } catch (err) {
    const code = (err as { code?: number }).code
    const message = err instanceof Error ? err.message : String(err)
    if (code === 400) return c.json({ error: 'bad_request', message }, 400)
    return c.json({ error: 'internal', message }, 500)
  }
})

workflowRoutes.post('/:id/disarm', (c) => {
  const stack = getStack()
  getTriggerManager(stack).disarm(c.req.param('id'))
  return c.json({ armed: false })
})

workflowRoutes.delete('/:id', (c) => {
  const stack = getStack()
  stack.workflows.delete(c.req.param('id'))
  return c.body(null, 204)
})

workflowRoutes.post('/:id/runs', async (c) => {
  const stack = getStack()
  const mgr = getRunManager(stack)
  try {
    const raw = await c.req.text()
    const body = raw.trim() ? RunBody.parse(JSON.parse(raw)) : {}
    const { runId } = await mgr.start(c.req.param('id'), undefined, body.nodeDataOverrides)
    return c.json({ runId }, 201)
  } catch (err) {
    const code = (err as { code?: number }).code
    const message = err instanceof Error ? err.message : String(err)
    if (err instanceof ZodError) return c.json({ error: 'invalid_graph', issues: err.issues }, 400)
    if (code === 409) return c.json({ error: 'already_running', message }, 409)
    if (code === 400) return c.json({ error: 'bad_request', message }, 400)
    return c.json({ error: 'internal', message }, 500)
  }
})

workflowRoutes.get('/:id/runs', (c) => {
  const stack = getStack()
  const runs = stack.workflowRuns.listRunsForWorkflow(c.req.param('id'))
  return c.json({ items: runs })
})

workflowRoutes.get('/runs/:runId', (c) => {
  const stack = getStack()
  const runId = c.req.param('runId')
  const run = stack.workflowRuns.getRun(runId)
  if (!run) return c.json({ error: 'not_found' }, 404)
  const steps = stack.workflowRuns.listSteps(runId)
  return c.json({ run, steps })
})

const DecisionBody = z.object({
  nodeId: z.string().min(1),
  decision: z.enum(['approved', 'rejected']),
  notes: z.string().optional(),
})

workflowRoutes.post('/runs/:runId/decisions', async (c) => {
  const stack = getStack()
  const mgr = getRunManager(stack)
  const body = DecisionBody.parse(await c.req.json())
  const ok = mgr.decide(c.req.param('runId'), body)
  if (!ok) return c.json({ error: 'no_pending_decision' }, 404)
  return c.json({ ok: true })
})

workflowRoutes.delete('/runs/:runId', (c) => {
  const stack = getStack()
  const mgr = getRunManager(stack)
  const runId = c.req.param('runId')
  if (mgr.isActive(runId)) {
    mgr.cancel(runId)
    return c.body(null, 204)
  }
  stack.workflowRuns.deleteRun(runId)
  return c.body(null, 204)
})

workflowRoutes.get('/:id/active-run', (c) => {
  const mgr = getRunManager(getStack())
  const runId = mgr.activeRunFor(c.req.param('id'))
  return c.json({ runId: runId ?? null })
})

workflowRoutes.get('/runs/:runId/events', (c) => {
  const stack = getStack()
  const mgr = getRunManager(stack)
  const runId = c.req.param('runId')

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      const sub = mgr.subscribe(runId, send)
      for (const e of sub.replay) send(e)
      // If the run had already finished by the time we subscribed, the replay
      // above includes the run-finished event. Close the stream eagerly — no
      // more events are coming.
      if (sub.finished) {
        sub.unsubscribe()
        try { controller.close() } catch { /* already closed */ }
        return
      }
      const close = () => {
        sub.unsubscribe()
        try { controller.close() } catch { /* already closed */ }
      }
      c.req.raw.signal.addEventListener('abort', close)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  })
})
