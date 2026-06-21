import { useEffect, useState } from 'react'

import {
  getHealth,
  listCompetitors,
  listConversations,
  listCronJobs,
  listProfiles,
  listSkills,
} from '@/api'
import { useProject } from '@/lib/use-project'
import { cn } from '@/lib/utils'
import { useNavigation, type PageKey } from '@/lib/navigation'
import { useKbLoader } from '@/lib/use-kb-loader'
import { useJobs } from '@/lib/use-jobs'
import { ActiveConversationPage } from '@/pages/active-conversation'
import { ContentPage } from '@/pages/content'
import { PlannerPage } from '@/pages/planner'
import { ContentStudioPage } from '@/pages/content-studio'
import { TasksPage } from '@/pages/tasks'
import { ConversationsPage } from '@/pages/conversations'
import { PlaceholderPage } from '@/pages/placeholder'
import { CompetitorsPage } from '@/pages/competitors'
import { ResearchPage } from '@/pages/research'
import { DiscoverCompetitorsPage } from '@/pages/discover-competitors'
import { CapturePostsPage } from '@/pages/capture-posts'
import { ProfileEditorPage } from '@/pages/profile-editor'
import { ProfilesPage } from '@/pages/profiles'
import { ScheduledPage } from '@/pages/scheduled'
import { SettingsPage } from '@/pages/settings'
import { SkillsPage } from '@/pages/skills'
import { WorkflowDemoPage } from '@/components/workflow'
import { WorkflowsPage } from '@/pages/workflows'
import { WorkflowEditorPage } from '@/pages/workflow-editor'
import { KnowledgeBasePage } from '@/pages/knowledge-base'
import { ExtractorPage } from '@/pages/extractor'
import { FlowPage } from '@/pages/flow'
import { JobCompletionAlerts } from '@/components/jobs/top-nav-progress'
import { Sidebar } from './sidebar'
import { TopBar } from './topbar'
import { ActionsGrid, type LiveCounts } from './actions-grid'
import type { Action } from './actions'

const BREADCRUMBS: Record<PageKey, string> = {
  home: 'Dashboard',
  conversations: 'Conversations',
  'active-conversation': 'Conversations',
  content: 'Content',
  planner: 'Content Planner',
  'content-studio': 'Content Studio',
  tasks: 'Tasks',
  profiles: 'Profiles',
  'profile-editor': 'Profiles · Edit',
  skills: 'Skills',
  competitors: 'Competitors',
  research: 'Research',
  'discover-competitors': 'Competitors · Discover',
  'capture-posts': 'Competitors · Capture',
  scheduled: 'Scheduled jobs',
  settings: 'Settings',
  'workflow-demo': 'Workflow demo',
  workflows: 'Workflows',
  'workflow-editor': 'Workflows · Editor',
  'knowledge-base': 'Knowledge Base',
  extractor: 'Extractor',
  flow: 'Flow Images',
}

type BackendState = 'checking' | 'online' | 'offline'

function StatusPill() {
  const [state, setState] = useState<BackendState>('checking')

  useEffect(() => {
    let active = true
    getHealth()
      .then(() => active && setState('online'))
      .catch(() => active && setState('offline'))
    return () => {
      active = false
    }
  }, [])

  const meta: Record<BackendState, { dot: string; label: string }> = {
    checking: { dot: 'bg-muted-foreground/50 animate-pulse', label: 'Connecting' },
    online: { dot: 'bg-[var(--anubis-success)]', label: 'Backend ready' },
    offline: { dot: 'bg-destructive', label: 'Backend offline' },
  }
  const { dot, label } = meta[state]

  return (
    <span className='inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground'>
      <span className={cn('size-1.5 rounded-full', dot)} />
      {label}
    </span>
  )
}

function LiveStatusRow({ counts }: { counts: LiveCounts }) {
  const items: { key: keyof LiveCounts; label: string }[] = [
    { key: 'profiles', label: 'profiles' },
    { key: 'conversations', label: 'conversations' },
    { key: 'skills', label: 'skills' },
    { key: 'cron', label: 'scheduled jobs' },
  ]

  return (
    <div className='flex flex-wrap items-center gap-2'>
      {items.map(({ key, label }) => {
        const n = counts[key]
        return (
          <span
            key={key}
            className='inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[12px] text-muted-foreground tabular-nums'
          >
            <span className='font-medium text-foreground'>
              {n === undefined ? '—' : n}
            </span>
            {label}
          </span>
        )
      })}
    </div>
  )
}

function useLiveCounts(): LiveCounts {
  const { activeProject } = useProject()
  const [counts, setCounts] = useState<LiveCounts>({})

  useEffect(() => {
    let active = true

    async function fetchAll() {
      const [profiles, conversations, skills, cron, competitors] = await Promise.allSettled([
        listProfiles(),
        listConversations({ limit: 200, projectId: activeProject?.id || undefined }),
        listSkills(),
        listCronJobs(undefined, activeProject?.id || undefined),
        listCompetitors(activeProject?.id || undefined),
      ])
      if (!active) return
      setCounts({
        profiles: profiles.status === 'fulfilled' ? profiles.value.length : undefined,
        conversations:
          conversations.status === 'fulfilled' ? conversations.value.length : undefined,
        skills: skills.status === 'fulfilled' ? skills.value.length : undefined,
        cron: cron.status === 'fulfilled' ? cron.value.length : undefined,
        competitors:
          competitors.status === 'fulfilled' ? competitors.value.length : undefined,
      })
    }

    void fetchAll()
    return () => {
      active = false
    }
  }, [activeProject?.id])

  return counts
}

function HomePage() {
  const { navigate } = useNavigation()
  const counts = useLiveCounts()

  function handleAction(action: Action) {
    switch (action.id) {
      case 'new-conversation':
      case 'browse-conversations':
        return navigate({ page: 'conversations' })
      case 'capture-profile':
      case 'discover-creators':
        return navigate({ page: 'competitors' })
      case 'browse-content':
        return navigate({ page: 'content' })
      case 'browse-profiles':
        return navigate({ page: 'profiles' })
      case 'browse-skills':
        return navigate({ page: 'skills' })
      case 'browse-cron':
        return navigate({ page: 'scheduled' })
      default:
        return
    }
  }

  return (
    <main className='flex-1 overflow-y-auto'>
      <div className='mx-auto flex w-full max-w-6xl flex-col gap-8 p-4 sm:p-6 lg:py-10'>
        <header className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
          <div>
            <h1 className='text-2xl font-semibold tracking-[-0.02em]'>
              Good morning, Falah
            </h1>
            <p className='mt-1 text-sm text-muted-foreground'>
              Pick an action to get started.
            </p>
          </div>
          <StatusPill />
        </header>

        <LiveStatusRow counts={counts} />

        <ActionsGrid counts={counts} onActionClick={handleAction} />
      </div>
    </main>
  )
}

function CurrentPage() {
  const { route } = useNavigation()

  switch (route.page) {
    case 'home':
      return <HomePage />
    case 'conversations':
      return <ConversationsPage />
    case 'active-conversation':
      return <ActiveConversationPage conversationId={route.conversationId} />
    case 'content':
      return <ContentPage />
    case 'planner':
      return <PlannerPage />
    case 'content-studio':
      return <ContentStudioPage />
    case 'tasks':
      return <TasksPage />
    case 'profiles':
      return <ProfilesPage />
    case 'profile-editor':
      return <ProfileEditorPage profileId={route.profileId} />
    case 'skills':
      return <SkillsPage />
    case 'competitors':
      return <CompetitorsPage />
    case 'research':
      return <ResearchPage />
    case 'discover-competitors':
      return <DiscoverCompetitorsPage jobId={route.jobId} />
    case 'capture-posts':
      return <CapturePostsPage jobId={route.jobId} competitorIds={route.competitorIds} />
    case 'scheduled':
      return <ScheduledPage />
    case 'settings':
      return <SettingsPage />
    case 'workflow-demo':
      return <WorkflowDemoPage />
    case 'workflows':
      return <WorkflowsPage />
    case 'workflow-editor':
      return <WorkflowEditorPage workflowId={route.workflowId} />
    case 'knowledge-base':
      return <KnowledgeBasePage />
    case 'extractor':
      return <ExtractorPage />
    case 'flow':
      return <FlowPage />
    default:
      return <HomePage />
  }
}

export function Dashboard() {
  const { route } = useNavigation()
  const { activeProject } = useProject()
  const loadProjectData = useKbLoader((s) => s.loadProjectData)
  const connectJobs = useJobs((s) => s.connect)
  const disconnectJobs = useJobs((s) => s.disconnect)

  useEffect(() => {
    if (activeProject?.id) {
      void loadProjectData(activeProject.id)
    }
  }, [activeProject?.id, loadProjectData])

  // Subscribe to the backend job feed for the lifetime of the app shell.
  useEffect(() => {
    connectJobs()
    return () => disconnectJobs()
  }, [connectJobs, disconnectJobs])

  return (
    <div className='flex h-screen w-screen overflow-hidden bg-background text-foreground'>
      <Sidebar />
      <div className='flex min-w-0 flex-1 flex-col'>
        <TopBar breadcrumb={BREADCRUMBS[route.page]} />
        <CurrentPage />
      </div>
      <JobCompletionAlerts />
    </div>
  )
}
