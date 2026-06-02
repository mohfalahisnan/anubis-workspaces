export type Agent = 'codex' | 'claude'

export const AGENTS: readonly Agent[] = ['codex', 'claude']

export type ModelCategory =
  | 'recommended'
  | 'recommended_research_preview'
  | 'alternative'

export interface ModelInfo {
  id: string
  category: ModelCategory
  description: string
}

export const MODELS: Record<Agent, ModelInfo[]> = {
  codex: [
    {
      id: 'gpt-5.5',
      category: 'recommended',
      description: 'Newest frontier model for complex coding, computer use, knowledge work, and research workflows in Codex.',
    },
    {
      id: 'gpt-5.4',
      category: 'recommended',
      description: 'Flagship frontier model for professional work, with strong reasoning, tool use, and agentic workflows.',
    },
    {
      id: 'gpt-5.4-mini',
      category: 'recommended',
      description: 'Fast, efficient mini model for responsive coding tasks and subagents.',
    },
    {
      id: 'gpt-5.3-codex',
      category: 'recommended',
      description: 'Coding model for complex software engineering.',
    },
    {
      id: 'gpt-5.3-codex-spark',
      category: 'recommended_research_preview',
      description: 'Text-only research preview model optimized for near-instant coding iteration.',
    },
    {
      id: 'gpt-5.2',
      category: 'alternative',
      description: 'Previous general-purpose model for coding and agentic tasks.',
    },
  ],
  claude: [
    {
      id: 'claude-opus-4-7',
      category: 'recommended',
      description: 'Opus 4.7 for complex reasoning and long-horizon tasks.',
    },
    {
      id: 'claude-sonnet-4-6',
      category: 'recommended',
      description: 'Sonnet 4.6 for balanced cost and quality in coding workflows.',
    },
    {
      id: 'claude-haiku-4-5',
      category: 'recommended',
      description: 'Haiku 4.5 for fast, lightweight tasks and subagents.',
    },
  ],
}

export const REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high'] as const
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]

export const DEFAULT_MODEL: Record<Agent, string> = {
  codex: 'gpt-5.5',
  claude: 'claude-sonnet-4-6',
}

export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'medium'

export function isKnownModel(agent: Agent, id: string): boolean {
  return MODELS[agent].some((m) => m.id === id)
}

export function isKnownEffort(value: string): value is ReasoningEffort {
  return (REASONING_EFFORTS as readonly string[]).includes(value)
}

export function isAgent(value: string): value is Agent {
  return (AGENTS as readonly string[]).includes(value)
}
