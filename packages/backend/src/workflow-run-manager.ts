import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ConversationStack } from '@anubis/conversation'
import {
  executorRegistry,
  runWorkflow,
  WorkflowGraphSchema,
  type CapturedPost,
  type FlowImageNodeOptions,
  type NodeRunEvent,
  type RunEvent,
  type RunStatus,
} from '@anubis/workflow-runtime'
import {
  captureInstagramData,
  silentReporter,
  flowGenerate,
  ensureFlowChrome,
  openFlowUrl,
  type StandardCrawlerOutput,
} from '@anubis/research-crawler'
import { withCrawlerProfileDefaults } from './chrome-defaults.js'
import { LessonStore } from './lesson-store.js'
import { runOcr, runTranscribe, type TranscribeOptions } from './extractor.js'
import { notify } from './utils/notifications.js'

type Listener = (event: RunEvent) => void

type Decision = { decision: 'approved' | 'rejected'; notes?: string }

interface ActiveRun {
  runId: string
  workflowId: string
  projectId: string
  controller: AbortController
  listeners: Set<Listener>
  buffered: RunEvent[]
  finished: boolean
  /** Human-approval nodes awaiting a decision, keyed by nodeId. */
  pendingApprovals: Map<string, { resolve: (d: Decision) => void; reject: (e: Error) => void }>
  /** Persist+emit a node event; set once the run loop starts. Used by decide(). */
  emitNode?: (e: NodeRunEvent) => void
}

const INLINE_OUTPUT_LIMIT = 256 * 1024

export class WorkflowRunManager {
  private active = new Map<string, ActiveRun>()
  private runsByWorkflow = new Map<string, string>()
  private lessons: LessonStore

  constructor(
    private stack: ConversationStack,
    private dataDir: string,
  ) {
    this.lessons = new LessonStore(dataDir)
  }

  async start(
    workflowId: string,
    triggerContext?: { nodeId: string; payload: unknown },
    nodeDataOverrides?: Record<string, unknown>,
  ): Promise<{ runId: string }> {
    if (this.runsByWorkflow.has(workflowId)) {
      const err = new Error('workflow already has an active run')
      ;(err as { code?: number }).code = 409
      throw err
    }
    const workflow = this.stack.workflows.get(workflowId)
    if (!workflow) throw new Error(`workflow ${workflowId} not found`)
    if (!workflow.publishedGraph) {
      const err = new Error('workflow has no published version')
      ;(err as { code?: number }).code = 400
      throw err
    }

    const graph = applyNodeDataOverrides(
      WorkflowGraphSchema.parse(JSON.parse(workflow.publishedGraph)),
      nodeDataOverrides,
    )
    const graphSnapshot = JSON.stringify(graph)

    const workflowProjectId = workflow.projectId ?? 'default'
    const runId = randomUUID()
    const controller = new AbortController()
    const listeners = new Set<Listener>()
    const buffered: RunEvent[] = []
    const active: ActiveRun = {
      runId, workflowId, projectId: workflowProjectId,
      controller, listeners, buffered, finished: false, pendingApprovals: new Map(),
    }
    this.active.set(runId, active)
    this.runsByWorkflow.set(workflowId, runId)

    const now = Date.now()
    this.stack.workflowRuns.createRun({
      id: runId,
      workflowId,
      projectId: workflowProjectId,
      graphSnapshot,
      now,
    })

    const emit = (event: RunEvent) => {
      if (active.finished) return
      buffered.push(event)
      for (const l of listeners) l(event)
    }

    const seed = triggerContext
      ? { [triggerContext.nodeId]: triggerContext.payload }
      : undefined

    void this.runAndPersist(active, graph, emit, now, seed).finally(() => {
      // Free the workflow slot so the user can start another run immediately.
      this.runsByWorkflow.delete(workflowId)
      // Keep the active entry (with buffered events) alive for a grace period
      // so late SSE subscribers — which is common for fast workflows that
      // finish before the EventSource connection completes — can still replay
      // the events. Without this, instantly-finishing workflows look stuck:
      // the run-started/node-*/run-finished events all happen before the
      // frontend's EventSource attaches, the buffered events get deleted, and
      // the subscriber sees an empty stream.
      setTimeout(() => this.active.delete(runId), 60_000).unref?.()
    })

    return { runId }
  }

  cancel(runId: string): boolean {
    const active = this.active.get(runId)
    if (!active) return false
    active.controller.abort()
    return true
  }

  /** Resolve a parked human-approval decision. Returns false if none is pending. */
  decide(runId: string, input: { nodeId: string; decision: 'approved' | 'rejected'; notes?: string }): boolean {
    const active = this.active.get(runId)
    const pending = active?.pendingApprovals.get(input.nodeId)
    if (!active || !pending) return false
    active.pendingApprovals.delete(input.nodeId)
    active.emitNode?.({ kind: 'node-decided', nodeId: input.nodeId, at: Date.now(), decision: input.decision, notes: input.notes })
    this.stack.workflowRuns.setRunStatus(runId, 'running', null, null)
    pending.resolve({ decision: input.decision, notes: input.notes })
    return true
  }

  subscribe(runId: string, listener: Listener): { unsubscribe: () => void; replay: RunEvent[]; finished: boolean } {
    const active = this.active.get(runId)
    if (!active) return { unsubscribe: () => {}, replay: [], finished: true }
    active.listeners.add(listener)
    return {
      finished: active.finished,
      unsubscribe: () => active.listeners.delete(listener),
      replay: [...active.buffered],
    }
  }

  isActive(runId: string): boolean {
    return this.active.has(runId)
  }

  /**
   * Returns the runId currently active for a workflow, or undefined. Used
   * by the editor page to auto-resubscribe when the user returns mid-run.
   */
  activeRunFor(workflowId: string): string | undefined {
    return this.runsByWorkflow.get(workflowId)
  }

  private async runAndPersist(
    active: ActiveRun,
    graph: ReturnType<typeof WorkflowGraphSchema.parse>,
    emit: (event: RunEvent) => void,
    startedAt: number,
    seed?: Record<string, unknown>,
  ): Promise<void> {
    const workflow = this.stack.workflows.get(active.workflowId)
    const workflowName = workflow?.name ?? 'Unknown'
    emit({ kind: 'run-started', runId: active.runId, at: startedAt })

    const wrappedEmit = async (event: NodeRunEvent) => {
      try {
        const repo = this.stack.workflowRuns
        const stepId = `${active.runId}:${event.nodeId}`
        if (event.kind === 'node-started') {
          repo.upsertStep({
            id: stepId, runId: active.runId, nodeId: event.nodeId,
            status: 'running', startedAt: event.at,
          })
        } else if (event.kind === 'node-succeeded') {
          const stored = await this.maybeMaterializeOutput(active.runId, event.nodeId, event.output)
          repo.upsertStep({
            id: stepId, runId: active.runId, nodeId: event.nodeId,
            status: 'succeeded', finishedAt: event.at, output: JSON.stringify(stored),
          })
        } else if (event.kind === 'node-awaiting') {
          repo.upsertStep({
            id: stepId, runId: active.runId, nodeId: event.nodeId,
            status: 'awaiting', startedAt: event.at,
          })
          repo.setRunStatus(active.runId, 'awaiting_approval', null, null)
        } else if (event.kind === 'node-decided') {
          // Run status returns to 'running' in decide(); the executor's own
          // node-succeeded event records the step's final state.
        } else if (event.kind === 'node-failed') {
          repo.upsertStep({
            id: stepId, runId: active.runId, nodeId: event.nodeId,
            status: 'failed', finishedAt: event.at, error: event.error || '(executor failed without a message)',
          })
        }
      } catch (err) {
        console.error('[workflow] failed to persist run step', err)
      }
      emit(event)
    }
    active.emitNode = wrappedEmit

    let status: RunStatus = 'failed'
    let runError: string | undefined
    try {
      const ctx = {
        crawler: { captureProfile: async (url: string): Promise<CapturedPost> => {
          const cfg = this.stack.appConfig.get()
          const project = this.stack.projects.findById(active.projectId)
          const workspacePath = project?.workdir
          const input = withCrawlerProfileDefaults(
            { url, reporter: silentReporter(), chromePath: cfg.chromePath, workspacePath },
            'public', cfg, this.dataDir,
          )
          const result: StandardCrawlerOutput = await captureInstagramData(input)
          return mapCrawlerOutputToCapturedPost(result, url)
        }},
        ocr: { extractFromImage: async (path: string) => {
          const result = await runOcr(path)
          return result.text
        }},
        transcribe: { fromMedia: async (path: string, opts?: TranscribeOptions) => {
          return runTranscribe(path, opts)
        }},
        flow: { generate: async (gen: FlowImageNodeOptions) => {
          const cfg = this.stack.appConfig.get()
          const chromeOrigin = await ensureFlowChrome(withCrawlerProfileDefaults(
            { url: gen.projectUrl, chromePath: cfg.chromePath },
            'flow', cfg, this.dataDir,
          ))
          if (gen.projectUrl) await openFlowUrl({ chromeOrigin, url: gen.projectUrl })
          const result = await flowGenerate({
            chromeOrigin,
            prompt: gen.prompt,
            ratio: gen.ratio,
            variations: gen.variations,
            model: gen.model,
            downloadDir: gen.downloadDir,
          })
          return {
            resultEditUrls: result.resultEditUrls,
            ...(result.downloadedImagePaths ? { downloadedImagePaths: result.downloadedImagePaths } : {}),
            model: result.model,
            ratio: result.ratio,
            variations: result.variations,
            tabUrl: result.tabUrl,
          }
        }},
        db: { getCapturedPost: async (id: string): Promise<CapturedPost> => {
          const post = this.stack.capturedPosts.findById(id)
          if (!post) throw new Error(`captured post ${id} not found`)
          if ((post.projectId ?? 'default') !== active.projectId) {
            throw new Error(`captured post ${id} does not belong to workflow project ${active.projectId}`)
          }
          return {
            id: post.id,
            caption: post.caption,
            mediaUrls: post.mediaUrl ? [post.mediaUrl] : [],
            metrics: { likes: post.likes, comments: post.comments },
            postUrl: post.postUrl,
          }
        }},
        fs: { writeRunArtifact: async (runId: string, nodeId: string, ext: string, data: Buffer) => {
          const dir = join(this.dataDir, 'workflow-runs', runId)
          await mkdir(dir, { recursive: true })
          const path = join(dir, `${nodeId}.${ext}`)
          await writeFile(path, data)
          return path
        }},
        conversations: {
          createAndAwaitFirstTurn: async (input: {
            title: string
            profileId: string
            reasoning?: 'minimal' | 'low' | 'medium' | 'high'
            content: string
            source?: 'workflow'
            workflow?: { runId: string; nodeId: string }
          }) => {
            const override = input.reasoning ? { reasoningEffort: input.reasoning } : undefined
            // Inject accumulated lessons into every workflow agent's first turn.
            const lessons = await this.lessons.injectionText()
            const content = lessons ? `${lessons}\n\n${input.content}` : input.content
            return this.stack.conversation.createAndAwaitFirstTurn({
              title: input.title,
              profileId: input.profileId,
              projectId: active.projectId,
              override,
              content,
              source: input.source,
              workflow: input.workflow,
              signal: active.controller.signal,
            })
          },
          cancel: async (conversationId: string) => {
            await this.stack.conversation.cancel(conversationId)
          },
        },
        lessons: {
          write: (input: { nodeId: string; lessonType: 'mistake' | 'lesson'; text: string; profileId?: string }) =>
            this.lessons.write({ ...input, runId: active.runId }),
        },
        approvals: {
          waitFor: (nodeId: string, opts: { title?: string; instructions?: string; upstream: unknown }) =>
            new Promise<Decision>((resolve, reject) => {
              active.pendingApprovals.set(nodeId, { resolve, reject })
              void wrappedEmit({ kind: 'node-awaiting', nodeId, at: Date.now(), title: opts.title, instructions: opts.instructions })
              notify('Workflow Approval Required', `Workflow "${workflowName}" is waiting for approval in node "${opts.title || nodeId}".`)
              const onAbort = () => { active.pendingApprovals.delete(nodeId); reject(new Error('run cancelled')) }
              if (active.controller.signal.aborted) onAbort()
              else active.controller.signal.addEventListener('abort', onAbort, { once: true })
            }),
        },
        planner: {
          save: async (input: {
            projectId?: string
            referencePostId?: string
            referenceUrl?: string
            title: string
            status?: 'idea' | 'review' | 'scheduled' | 'published' | 'rejected'
            rawBrief?: string
            improvedDraft?: string
          }) => {
            const id = randomUUID()
            const item = this.stack.contentItems.create({
              id,
              projectId: input.projectId ?? active.projectId,
              referencePostId: input.referencePostId,
              referenceUrl: input.referenceUrl,
              title: input.title,
              status: input.status,
              rawBrief: input.rawBrief,
              improvedDraft: input.improvedDraft,
              sourceWorkflowRunId: active.runId,
              now: Date.now(),
            })
            return { id: item.id }
          }
        },
        runId: active.runId,
        signal: active.controller.signal,
        emit: (e: NodeRunEvent) => { void wrappedEmit(e) },
        workspacePath: this.stack.projects.findById(active.projectId)?.workdir,
      }
      const result = await runWorkflow(graph, executorRegistry, ctx, { seed })
      status = result.status
      runError = result.error
    } catch (err) {
      runError = (err instanceof Error ? err.message : String(err)) || '(unknown runtime error)'
      status = 'failed'
    }

    const finishedAt = Date.now()
    if (status === 'failed' && !runError) runError = 'run failed without a reported error'
    this.stack.workflowRuns.setRunStatus(active.runId, status, finishedAt, runError ?? null)
    emit({ kind: 'run-finished', runId: active.runId, at: finishedAt, status, error: runError })
    active.finished = true

    if (status === 'succeeded') {
      notify('Workflow Completed', `Workflow "${workflowName}" finished successfully.`)
    } else if (status === 'failed') {
      notify('Workflow Failed', `Workflow "${workflowName}" failed: ${runError}`)
    }
  }

  private async maybeMaterializeOutput(
    runId: string,
    nodeId: string,
    output: unknown,
  ): Promise<unknown> {
    const serialized = JSON.stringify(output)
    if (serialized.length <= INLINE_OUTPUT_LIMIT) return output
    const dir = join(this.dataDir, 'workflow-runs', runId)
    await mkdir(dir, { recursive: true })
    const path = join(dir, `${nodeId}.output.json`)
    await writeFile(path, serialized)
    return { kind: 'file', path, mimeType: 'application/json', sizeBytes: serialized.length }
  }
}

function mapCrawlerOutputToCapturedPost(result: StandardCrawlerOutput, sourceUrl: string): CapturedPost {
  const post = result.output.posts[0]
  if (post) {
    return {
      id: post.postUrl ?? sourceUrl,
      caption: post.caption,
      mediaUrls: post.media?.urls ?? (post.media?.videoUrl ? [post.media.videoUrl] : []),
      metrics: { likes: post.likes, comments: post.comments },
      assetPaths: post.assetPaths,
      failedAssets: post.failedAssets,
    }
  }
  const profile = result.output.profiles[0]
  if (profile) {
    return {
      id: (profile as { username?: string }).username ?? sourceUrl,
      caption: (profile as { bio?: string }).bio,
      mediaUrls: [],
    }
  }
  throw new Error(`crawler returned no posts or profiles for url: ${sourceUrl}`)
}

function applyNodeDataOverrides(
  graph: ReturnType<typeof WorkflowGraphSchema.parse>,
  overrides?: Record<string, unknown>,
): ReturnType<typeof WorkflowGraphSchema.parse> {
  if (!overrides || Object.keys(overrides).length === 0) return graph
  const ids = new Set(graph.nodes.map((node) => node.id))
  for (const id of Object.keys(overrides)) {
    if (!ids.has(id)) {
      const err = new Error(`node override targets unknown node: ${id}`)
      ;(err as { code?: number }).code = 400
      throw err
    }
  }
  return WorkflowGraphSchema.parse({
    nodes: graph.nodes.map((node) => (
      Object.prototype.hasOwnProperty.call(overrides, node.id)
        ? { ...node, data: overrides[node.id] }
        : node
    )),
    edges: graph.edges,
  })
}
