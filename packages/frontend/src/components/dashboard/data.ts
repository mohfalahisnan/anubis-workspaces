import {
  ActivityIcon,
  BarChart3Icon,
  CalendarClockIcon,
  FileTextIcon,
  ImageIcon,
  ImagesIcon,
  ListChecksIcon,
  ClipboardListIcon,
  LayoutDashboardIcon,
  LibraryIcon,
  ScrollTextIcon,
  SendIcon,
  Settings2Icon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  TerminalIcon,
  UsersRoundIcon,
  WorkflowIcon,
  type LucideIcon,
} from 'lucide-react'

import type { PageKey } from '@/lib/navigation'

export type NavItem = {
  label: string
  icon: LucideIcon
  badge?: string
  page: PageKey
}

export const navItems: NavItem[] = [
  { label: 'Dashboard', icon: LayoutDashboardIcon, page: 'home' },
  { label: 'Conversations', icon: ScrollTextIcon, page: 'conversations' },
  { label: 'Competitors', icon: UsersRoundIcon, page: 'competitors' },
  { label: 'Content', icon: ImagesIcon, page: 'content' },
  { label: 'Content Planner', icon: ListChecksIcon, page: 'planner' },
  { label: 'Tasks', icon: ClipboardListIcon, page: 'tasks' },
  { label: 'Profiles', icon: SlidersHorizontalIcon, page: 'profiles' },
  { label: 'Skills', icon: LibraryIcon, page: 'skills' },
  { label: 'Scheduled', icon: CalendarClockIcon, page: 'scheduled' },
  { label: 'Workflows', icon: WorkflowIcon, page: 'workflows' },
  { label: 'Playground', icon: TerminalIcon, page: 'crawler-playground' },
  { label: 'Settings', icon: Settings2Icon, page: 'settings' },
]

export type Stat = {
  label: string
  value: string
  delta: number
  hint: string
  icon: LucideIcon
}

export const stats: Stat[] = [
  { label: 'Active agents', value: '12', delta: 2, hint: 'vs. last week', icon: ActivityIcon },
  { label: 'Content generated', value: '1,284', delta: 18.2, hint: 'this month', icon: SparklesIcon },
  { label: 'Published', value: '342', delta: 12.4, hint: 'this month', icon: SendIcon },
  { label: 'Avg. engagement', value: '4.8%', delta: -0.6, hint: 'last 30 days', icon: BarChart3Icon },
]

export type AgentStatus = 'active' | 'idle' | 'paused' | 'error'

export type Agent = {
  name: string
  role: string
  status: AgentStatus
  load: number
  icon: LucideIcon
}

export const agents: Agent[] = [
  { name: 'Atlas', role: 'Research & trends', status: 'active', load: 82, icon: ActivityIcon },
  { name: 'Scribe', role: 'Long-form writer', status: 'active', load: 64, icon: FileTextIcon },
  { name: 'Pixel', role: 'Image generation', status: 'active', load: 47, icon: ImageIcon },
  { name: 'Echo', role: 'Social repurposer', status: 'idle', load: 0, icon: SendIcon },
  { name: 'Sentinel', role: 'Brand compliance', status: 'paused', load: 0, icon: ShieldCheckIcon },
]

export type Activity = {
  agent: string
  action: string
  target: string
  time: string
}

export const activity: Activity[] = [
  { agent: 'Scribe', action: 'published', target: 'Q3 Growth Playbook', time: '2m ago' },
  { agent: 'Atlas', action: 'captured 48 trending topics from', target: 'Instagram', time: '14m ago' },
  { agent: 'Echo', action: 'generated 6 social variants of', target: 'Launch Recap', time: '1h ago' },
  { agent: 'Sentinel', action: 'flagged for review', target: 'Pricing Update post', time: '2h ago' },
  { agent: 'Pixel', action: 'rendered 12 thumbnails for', target: 'Tutorial series', time: '3h ago' },
]

export type Stage = {
  label: string
  count: number
  tone: 'muted' | 'accent' | 'positive'
}

export const pipeline: Stage[] = [
  { label: 'Ideation', count: 24, tone: 'muted' },
  { label: 'Drafting', count: 11, tone: 'accent' },
  { label: 'In review', count: 6, tone: 'accent' },
  { label: 'Scheduled', count: 9, tone: 'positive' },
  { label: 'Published', count: 342, tone: 'positive' },
]

// Content output over the last 7 days (normalised 0–100 for the mini chart).
export const output7d = [
  { day: 'Mon', value: 42 },
  { day: 'Tue', value: 68 },
  { day: 'Wed', value: 55 },
  { day: 'Thu', value: 81 },
  { day: 'Fri', value: 73 },
  { day: 'Sat', value: 38 },
  { day: 'Sun', value: 49 },
]
