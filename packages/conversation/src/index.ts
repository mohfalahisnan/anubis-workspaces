import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { type AiAgentService, createAiAgentService } from '@anubis/ai-agent'
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
import { ContentItemsRepo } from './db/repositories/content-items-repo.js'
import { TasksRepo } from './db/repositories/tasks-repo.js'
import { WorkflowsRepo } from './db/repositories/workflows-repo.js'
import { WorkflowRunsRepo } from './db/repositories/workflow-runs-repo.js'
import { WorkflowTriggersRepo } from './db/repositories/workflow-triggers-repo.js'
import { ProjectsRepo } from './db/repositories/projects-repo.js'
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
  contentItems: ContentItemsRepo
  tasks: TasksRepo
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
  projects: ProjectsRepo
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
  const projectsRepo = new ProjectsRepo(db)

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
  const contentItems = new ContentItemsRepo(db)
  const tasks = new TasksRepo(db)
  const workflowsRepo = new WorkflowsRepo(db)
  workflowsRepo.seedBuiltins()
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
    projects: projectsRepo,
    agentHomeRoot,
    workspacesRoot,
  })

  cron.loadFromDb()

  return {
    conversation, profiles, competitors, capturedPosts, contentItems, tasks,
    workflows: workflowsRepo,
    workflowRuns: workflowRunsRepo,
    workflowTriggers: workflowTriggersRepo,
    appConfig, skills, sse, cron, taskManager: tm, aiAgent,
    knownWorkspaces: knownWorkspacesRepo,
    projects: projectsRepo,
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
export type { ProjectContext } from './skills/inject.js'
export { computeInitialSkills } from './skills/snapshot.js'
export type { CronJob } from './db/repositories/cron-jobs-repo.js'
export type { Competitor } from './db/repositories/competitors-repo.js'
export type { CapturedPost, ListPostsOpts } from './db/repositories/captured-posts-repo.js'
export { CapturedPostsRepo } from './db/repositories/captured-posts-repo.js'
export type { ContentItem, ListContentItemsOpts, UpdateContentItemPatch } from './db/repositories/content-items-repo.js'
export { ContentItemsRepo } from './db/repositories/content-items-repo.js'
export type { Task, ListTasksOpts, UpdateTaskPatch } from './db/repositories/tasks-repo.js'
export { TasksRepo } from './db/repositories/tasks-repo.js'
export type { KnownWorkspace } from './db/repositories/known-workspaces-repo.js'
export { KnownWorkspacesRepo } from './db/repositories/known-workspaces-repo.js'
export type { Workflow } from './db/repositories/workflows-repo.js'
export { WorkflowsRepo } from './db/repositories/workflows-repo.js'
export type { BuiltinWorkflow } from './workflows/builtin.js'
export { BUILTIN_WORKFLOWS } from './workflows/builtin.js'
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
export type { Project } from './db/repositories/projects-repo.js'
export { ProjectsRepo } from './db/repositories/projects-repo.js'
export { newId } from './util/ids.js'
