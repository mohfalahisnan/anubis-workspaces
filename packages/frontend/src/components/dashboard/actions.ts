import {
  CalendarClockIcon,
  CompassIcon,
  ImagesIcon,
  LibraryIcon,
  MessageSquarePlusIcon,
  ScrollTextIcon,
  SlidersHorizontalIcon,
  UsersRoundIcon,
  type LucideIcon,
} from 'lucide-react'

export type ActionLiveKey =
  | 'profiles'
  | 'conversations'
  | 'skills'
  | 'cron'
  | 'competitors'
  | 'content'

export type Action = {
  id: string
  title: string
  description: string
  icon: LucideIcon
  /** Optional live count source — populated from the backend at render time. */
  live?: ActionLiveKey
  /** Suffix shown after the live number (e.g. "ready"). */
  liveLabel?: string
  /** Marks the recommended primary action — gets the gold accent. */
  primary?: boolean
}

export const actions: Action[] = [
  {
    id: 'new-conversation',
    title: 'Start a conversation',
    description: 'Pick a profile, set a workspace, and brief the agent.',
    icon: MessageSquarePlusIcon,
    live: 'profiles',
    liveLabel: 'profiles ready',
    primary: true,
  },
  {
    id: 'capture-profile',
    title: 'Capture an Instagram profile',
    description: 'Scrape posts + metadata for a competitor or reference.',
    icon: UsersRoundIcon,
    live: 'competitors',
    liveLabel: 'tracked',
  },
  {
    id: 'discover-creators',
    title: 'Discover creators',
    description: 'Find adjacent accounts to add to your watchlist.',
    icon: CompassIcon,
  },
  {
    id: 'browse-content',
    title: 'Content library',
    description: 'Browse captured posts and add winners to the index.',
    icon: ImagesIcon,
    live: 'content',
    liveLabel: 'posts captured',
  },
  {
    id: 'browse-profiles',
    title: 'Profiles',
    description: 'Built-in and custom agent presets with merged overrides.',
    icon: SlidersHorizontalIcon,
    live: 'profiles',
    liveLabel: 'total',
  },
  {
    id: 'browse-skills',
    title: 'Skills catalog',
    description: 'SKILL.md files discovered from disk, auto and opt-in.',
    icon: LibraryIcon,
    live: 'skills',
    liveLabel: 'available',
  },
  {
    id: 'browse-conversations',
    title: 'Recent conversations',
    description: 'Resume an in-flight thread or open a completed turn.',
    icon: ScrollTextIcon,
    live: 'conversations',
    liveLabel: 'total',
  },
  {
    id: 'browse-cron',
    title: 'Scheduled jobs',
    description: 'Cron jobs your agents created to re-invoke themselves.',
    icon: CalendarClockIcon,
    live: 'cron',
    liveLabel: 'scheduled',
  },
]
