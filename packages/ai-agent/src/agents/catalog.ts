export type Agent = 'codex' | 'claude' | 'antigravity' | 'gpt-web' | 'qwen-web' | 'qoder'

export const AGENTS: readonly Agent[] = ['codex', 'claude', 'antigravity', 'gpt-web', 'qwen-web', 'qoder']

export type ModelCategory =
  | 'recommended'
  | 'recommended_research_preview'
  | 'alternative'

export interface ModelInfo {
  id: string
  category: ModelCategory
  description: string
  /**
   * Human-readable label for the model. Optional — when absent the UI shows
   * `id`. Used by agents (e.g. Qoder) whose model `id`s are opaque server
   * slugs (`qmodel_latest`, `gm51model`) that mean nothing to the user.
   */
  displayName?: string
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
  antigravity: [
    {
      id: 'gemini-3.1-pro',
      category: 'recommended',
      description: 'Gemini 3.1 Pro for complex reasoning and multi-file agentic coding in the Antigravity CLI.',
    },
    {
      id: 'gemini-3.5-flash',
      category: 'recommended',
      description: 'Gemini 3.5 Flash for fast, low-latency coding iteration.',
    },
    {
      id: 'claude-opus',
      category: 'alternative',
      description: 'Anthropic Claude Opus served through Antigravity for deep reasoning tasks.',
    },
    {
      id: 'claude-sonnet',
      category: 'alternative',
      description: 'Anthropic Claude Sonnet served through Antigravity for balanced cost and quality.',
    },
    {
      id: 'gpt-oss-120b',
      category: 'alternative',
      description: 'Open-weight GPT-OSS 120B model available through Antigravity.',
    },
  ],
  'gpt-web': [
    {
      id: 'chatgpt-web',
      category: 'recommended',
      description: 'ChatGPT Web interface via crawler CDP automation.',
    },
  ],
  'qwen-web': [
    {
      id: 'qwen-web',
      category: 'recommended',
      description: 'Qwen (chat.qwen.ai) Web interface via crawler CDP automation.',
    },
  ],
  qoder: [
    {
      id: 'auto',
      category: 'recommended',
      description: 'Automatic model selection — Qoder picks the best model for the task.',
    },
    {
      id: 'ultimate',
      category: 'recommended',
      description: 'Highest-capability model for complex reasoning and large-scale refactoring.',
    },
    {
      id: 'performance',
      category: 'recommended',
      description: 'Balanced model for professional coding with strong tool use.',
    },
    {
      id: 'efficient',
      category: 'alternative',
      description: 'Cost-efficient model for routine coding tasks.',
    },
    {
      id: 'lite',
      category: 'alternative',
      description: 'Lightweight model for fast iteration and simple edits.',
    },
  ],
}

export const REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high'] as const
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]

export const DEFAULT_MODEL: Record<Agent, string> = {
  codex: 'gpt-5.5',
  claude: 'claude-sonnet-4-6',
  antigravity: 'gemini-3.1-pro',
  'gpt-web': 'chatgpt-web',
  'qwen-web': 'qwen-web',
  qoder: 'auto',
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
