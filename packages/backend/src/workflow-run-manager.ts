import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ConversationStack } from '@anubis/conversation'
import {
  executorRegistry,
  runWorkflow,
  WorkflowGraphSchema,
  type CapturedPost,
  type NodeRunEvent,
  type RunEvent,
  type RunStatus,
} from '@anubis/workflow-runtime'
import { captureInstagramData, silentReporter, type StandardCrawlerOutput } from '@anubis/research-crawler'
import { withCrawlerProfileDefaults } from './chrome-defaults.js'

type Listener = (event: RunEvent) => void

interface ActiveRun {
  runId: string
  controller: AbortController
  listeners: Set<Listener>
  buffered: RunEvent[]
  finished: boolean
}

const INLINE_OUTPUT_LIMIT = 256 * 1024

export class WorkflowRunManager {
  private active = new Map<string, ActiveRun>()
  private runsByWorkflow = new Map<string, string>()

  constructor(
    private stack: ConversationStack,
    private dataDir: string,
  ) {}

  async start(workflowId: string): Promise<{ runId: string }> {
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

    WorkflowGraphSchema.parse(JSON.parse(workflow.publishedGraph))

    const runId = randomUUID()
    const controller = new AbortController()
    const listeners = new Set<Listener>()
    const buffered: RunEvent[] = []
    const active: ActiveRun = { runId, controller, listeners, buffered, finished: false }
    this.active.set(runId, active)
    this.runsByWorkflow.set(workflowId, runId)

    const now = Date.now()
    this.stack.workflowRuns.createRun({
      id: runId,
      workflowId,
      graphSnapshot: workflow.publishedGraph,
      now,
    })

    const emit = (event: RunEvent) => {
      if (active.finished) return
      buffered.push(event)
      for (const l of listeners) l(event)
    }

    void this.runAndPersist(active, JSON.parse(workflow.publishedGraph), emit, now).finally(() => {
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
  ): Promise<void> {
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
        } else {
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

    let status: RunStatus = 'failed'
    let runError: string | undefined
    try {
      const ctx = {
        crawler: { captureProfile: async (url: string): Promise<CapturedPost> => {
          const cfg = this.stack.appConfig.get()
          const input = withCrawlerProfileDefaults(
            { url, reporter: silentReporter(), chromePath: cfg.chromePath },
            'public', cfg, this.dataDir,
          )
          const result: StandardCrawlerOutput = await captureInstagramData(input)
          return mapCrawlerOutputToCapturedPost(result, url)
        }},
        ocr: { extractFromImage: async (_path: string) => {
          throw new Error('ocr.extractFromImage not yet wired (anubis-extractor integration is follow-up)')
        }},
        db: { getCapturedPost: async (id: string): Promise<CapturedPost> => {
          const post = this.stack.capturedPosts.findById(id)
          if (!post) throw new Error(`captured post ${id} not found`)
          return {
            id: post.id,
            caption: post.caption,
            mediaUrls: post.mediaUrl ? [post.mediaUrl] : [],
            metrics: { likes: post.likes, comments: post.comments },
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
          }) => {
            const override = input.reasoning ? { reasoningEffort: input.reasoning } : undefined
            return this.stack.conversation.createAndAwaitFirstTurn({
              title: input.title,
              profileId: input.profileId,
              override,
              content: input.content,
              signal: active.controller.signal,
            })
          },
          cancel: async (conversationId: string) => {
            await this.stack.conversation.cancel(conversationId)
          },
        },
        runId: active.runId,
        signal: active.controller.signal,
        emit: (e: NodeRunEvent) => { void wrappedEmit(e) },
      }
      const result = await runWorkflow(graph, executorRegistry, ctx)
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
