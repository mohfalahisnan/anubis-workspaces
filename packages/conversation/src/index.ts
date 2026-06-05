import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { type AiAgentService, createAiAgentService } from '@anubis/ai-agent'
import {
  ContentContextPacksRepo,
  ContentMemoryService,
  ContentSimilarityItemsRepo,
  ContextPackService,
  BrandWorkspacesRepo,
  BrandWorkspacesService,
  KnowledgeDocumentsRepo,
  SimilarityIngestionService,
  XenovaEmbedder,
  bundledModelCacheDir,
} from '@anubis/content-memory'
import { CapturedPostsSimilarityIngestor } from './competitors/similarity-ingestor.js'
import { openDatabase } from './db/client.js'
import { runMigrations } from './db/migrate.js'
import { MIGRATIONS } from './db/migrations/index.js'
import { ProfilesRepo } from './db/repositories/profiles-repo.js'
import { ConversationsRepo } from './db/repositories/conversations-repo.js'
import { MessagesRepo } from './db/repositories/messages-repo.js'
import { ArtifactsRepo } from './db/repositories/artifacts-repo.js'
import { AgentSessionsRepo } from './db/repositories/agent-sessions-repo.js'
import { KnownWorkspacesRepo } from './db/repositories/known-workspaces-repo.js'
import { CronJobsRepo } from './db/repositories/cron-jobs-repo.js'
import { CompetitorsRepo } from './db/repositories/competitors-repo.js'
import { CompetitorsService } from './competitors/competitors-service.js'
import { CapturedPostsRepo } from './db/repositories/captured-posts-repo.js'
import { WorkflowsRepo } from './db/repositories/workflows-repo.js'
import { WorkflowRunsRepo } from './db/repositories/workflow-runs-repo.js'
import { WorkflowTriggersRepo } from './db/repositories/workflow-triggers-repo.js'
import { AppConfigService } from './config/app-config.js'
import { ProfileService } from './profiles/profile-service.js'
import { SkillLoader, type SkillRoots } from './skills/loader.js'
import { SseBroadcaster } from './sse/broadcaster.js'
import { CronService } from './cron/cron-service.js'
import { NodeCronScheduler } from './cron/node-cron-scheduler.js'
import { TaskManager } from './conversations/task-manager.js'
import { ConversationService } from './conversations/conversation-service.js'

export interface CreateConversationServiceOpts {
  dataDir: string
  skillRoots: SkillRoots
  aiAgent?: AiAgentService
  idleMs?: number
}

export interface ConversationStack {
  conversation: ConversationService
  profiles: ProfileService
  competitors: CompetitorsService
  capturedPosts: CapturedPostsRepo
  workflows: WorkflowsRepo
  workflowRuns: WorkflowRunsRepo
  workflowTriggers: WorkflowTriggersRepo
  appConfig: AppConfigService
  skills: SkillLoader
  sse: SseBroadcaster
  cron: CronService
  taskManager: TaskManager
  aiAgent: AiAgentService
  knownWorkspaces: KnownWorkspacesRepo
  brandWorkspaces: BrandWorkspacesService
  knowledgeDocuments: KnowledgeDocumentsRepo
  similarityItems: ContentSimilarityItemsRepo
  similarityIngestion: SimilarityIngestionService
  capturedPostsSimilarity: CapturedPostsSimilarityIngestor
  contentMemory: ContentMemoryService
  /** Root path under which each profile's per-agent home dir lives. */
  agentHomeRoot: string
  shutdown(): Promise<void>
}

export function createConversationService(opts: CreateConversationServiceOpts): ConversationStack {
  mkdirSync(opts.dataDir, { recursive: true })
  const agentHomeRoot = join(opts.dataDir, 'agent-homes')
  mkdirSync(agentHomeRoot, { recursive: true })
  const workspacesRoot = join(opts.dataDir, 'workspaces')
  mkdirSync(workspacesRoot, { recursive: true })
  const db = openDatabase(join(opts.dataDir, 'anubis.db'))
  runMigrations(db, MIGRATIONS)

  const profilesRepo = new ProfilesRepo(db)
  const conversationsRepo = new ConversationsRepo(db)
  const messagesRepo = new MessagesRepo(db)
  const artifactsRepo = new ArtifactsRepo(db)
  const sessionsRepo = new AgentSessionsRepo(db)
  const cronRepo = new CronJobsRepo(db)
  const knownWorkspacesRepo = new KnownWorkspacesRepo(db)
  const brandWorkspaces = new BrandWorkspacesService(new BrandWorkspacesRepo(db))
  const knowledgeDocuments = new KnowledgeDocumentsRepo(db)
  // Offline-first: load the bundled model, never hit the network. In the
  // packaged app, swap cacheDir for join(process.resourcesPath, 'models')
  // (design §9 open item).
  const contentEmbedder = new XenovaEmbedder({
    cacheDir: bundledModelCacheDir(),
    allowRemoteModels: false,
  })
  const similarityItems = new ContentSimilarityItemsRepo(db)
  const similarityIngestion = new SimilarityIngestionService(similarityItems, contentEmbedder)
  const capturedPostsSimilarity = new CapturedPostsSimilarityIngestor(db, similarityIngestion)
  const contextPack = new ContextPackService({
    brands: new BrandWorkspacesRepo(db),
    docs: knowledgeDocuments,
    items: similarityItems,
    embedder: contentEmbedder,
  })
  const contentMemory = new ContentMemoryService({
    contextPack,
    packs: new ContentContextPacksRepo(db),
  })

  const profiles = new ProfileService(profilesRepo)
  profiles.seedBuiltins()
  try {
    profiles.bootstrapDefaultClaudeProfile({
      systemSource: join(homedir(), '.claude'),
      agentHomeRoot,
    })
  } catch (e) {
    // Boot must not fail because of a bootstrap glitch — log + continue.
    // eslint-disable-next-line no-console
    console.warn('[anubis] bootstrap default profile failed:', e)
  }
  const competitors = new CompetitorsService(new CompetitorsRepo(db))
  const capturedPosts = new CapturedPostsRepo(db)
  const workflowsRepo = new WorkflowsRepo(db)
  const workflowRunsRepo = new WorkflowRunsRepo(db)
  const workflowTriggersRepo = new WorkflowTriggersRepo(db)
  const appConfig = new AppConfigService(opts.dataDir)

  const skills = new SkillLoader(opts.skillRoots)
  const sse = new SseBroadcaster()
  const aiAgent = opts.aiAgent ?? createAiAgentService()
  const tm = new TaskManager(aiAgent, { idleMs: opts.idleMs ?? 10 * 60_000 })

  const cron = new CronService({
    repo: cronRepo,
    fire: async (conversationId, prompt) => {
      try { await conversation.sendMessage(conversationId, { content: prompt }) }
      catch (e) { console.error('[cron] fire failed', conversationId, e) }
    },
    scheduler: new NodeCronScheduler(),
  })

  const conversation = new ConversationService({
    db, profiles, skills, sse, cron, tm, aiAgent,
    conversations: conversationsRepo,
    messages: messagesRepo,
    artifacts: artifactsRepo,
    sessions: sessionsRepo,
    knownWorkspaces: knownWorkspacesRepo,
    agentHomeRoot,
    workspacesRoot,
  })

  cron.loadFromDb()

  return {
    conversation, profiles, competitors, capturedPosts,
    workflows: workflowsRepo,
    workflowRuns: workflowRunsRepo,
    workflowTriggers: workflowTriggersRepo,
    appConfig, skills, sse, cron, taskManager: tm, aiAgent,
    knownWorkspaces: knownWorkspacesRepo,
    brandWorkspaces,
    knowledgeDocuments,
    similarityItems,
    similarityIngestion,
    capturedPostsSimilarity,
    contentMemory,
    agentHomeRoot,
    async shutdown() {
      cron.shutdown()
      await tm.shutdown()
      db.close()
    },
  }
}

export type { Conversation, Message, Artifact, AgentSession, ConversationExtra, ConversationStatus, MessageRole } from './conversations/types.js'
export type { Profile, ProfileConfig, ProfileOverride, ProfileSource, ResolvedProfile } from './profiles/types.js'
export type { SkillDefinition, SkillIndex, SkillSource } from './skills/types.js'
export { toIndex as toSkillIndex } from './skills/types.js'
export { composeAppendSystemPrompt } from './skills/inject.js'
export { computeInitialSkills } from './skills/snapshot.js'
export type { CronJob } from './db/repositories/cron-jobs-repo.js'
export type { Competitor } from './db/repositories/competitors-repo.js'
export type { CapturedPost, ListPostsOpts } from './db/repositories/captured-posts-repo.js'
export { CapturedPostsRepo } from './db/repositories/captured-posts-repo.js'
export type { KnownWorkspace } from './db/repositories/known-workspaces-repo.js'
export { KnownWorkspacesRepo } from './db/repositories/known-workspaces-repo.js'
export type { Workflow } from './db/repositories/workflows-repo.js'
export { WorkflowsRepo } from './db/repositories/workflows-repo.js'
export type { WorkflowRun, WorkflowRunStep, RunStatus, StepStatus } from './db/repositories/workflow-runs-repo.js'
export { WorkflowRunsRepo } from './db/repositories/workflow-runs-repo.js'
export type { WorkflowTriggerState } from './db/repositories/workflow-triggers-repo.js'
export { WorkflowTriggersRepo } from './db/repositories/workflow-triggers-repo.js'
export type { AppConfig } from './config/app-config.js'
export { AppConfigService } from './config/app-config.js'
export { ConversationService, NoCredentialsError } from './conversations/conversation-service.js'
export {
  ensureAgentHome,
  envFor,
  hasCredentials,
  homePathFor,
  writeProfileInstructions,
  writeProfileSkills,
  CREDENTIAL_FILE,
} from './profiles/agent-home.js'
export { ProfileService } from './profiles/profile-service.js'
export { CompetitorsService } from './competitors/competitors-service.js'
export { SkillLoader } from './skills/loader.js'
export type { SkillRoots } from './skills/loader.js'
export { importSkill, SkillImportError } from './skills/import.js'
export type { ImportSkillOpts, ImportSkillResult, SkillCategory } from './skills/import.js'
export { CronService } from './cron/cron-service.js'
export { SseBroadcaster } from './sse/broadcaster.js'
export type { SseEvent } from './sse/broadcaster.js'
export type { BrandWorkspace, KnowledgeDocument, ScoredDocument } from '@anubis/content-memory'
export { DEFAULT_WORKSPACE_ID } from '@anubis/content-memory'
