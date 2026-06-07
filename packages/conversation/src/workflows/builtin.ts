/**
 * Built-in workflows seeded into every install on boot (see WorkflowsRepo.seedBuiltins).
 *
 * The graph shape matches `@anubis/workflow-runtime`'s WorkflowGraphSchema and
 * React Flow's wire shape. Edge handle ids mirror the frontend's
 * `WORKFLOW_SOURCE_HANDLE` / `WORKFLOW_TARGET_HANDLE` and the Human Review
 * branch handles — kept as literals here so this package stays free of any
 * frontend import.
 */

const OUT = 'out-main'
const IN = 'in-main'
const APPROVED = 'approved'

const ANALYST_PROMPT = [
  'You are an expert Instagram content analyst. The upstream context contains the original post — its caption and any media.',
  'Analyze it: identify the hook, the content structure, the tone of voice, the target audience, the call-to-action, and what makes the copy land or fall flat.',
  'Be specific and quote the actual caption where relevant. Return clear, skimmable notes.',
].join(' ')

const IMPROVE_PROMPT = [
  'You are an expert Instagram copywriter. The upstream context contains the original caption and a content analyst’s breakdown of it.',
  'Rewrite the caption so it is more engaging and scroll-stopping while preserving the original’s core message, offer, and brand voice:',
  'a strong hook on the first line, a tight body, and a clear CTA.',
  'Output the improved caption exactly as it should be posted, with no extra commentary.',
].join(' ')

/** The "IG Content Pipeline" starter graph: analyze → improve → review, plus an Original Copy viewer. */
const IG_CONTENT_PIPELINE_GRAPH = {
  nodes: [
    // Source — ships unconfigured; the user sets the Instagram post URL before running.
    { id: 'ig-source', type: 'instagramPost', position: { x: 0, y: 260 }, data: { source: 'url', url: '' } },
    // Analyze.
    {
      id: 'analyst',
      type: 'aiAgentConversation',
      position: { x: 440, y: 40 },
      data: { profileId: 'claude-research', prompt: ANALYST_PROMPT, titleTemplate: 'Content Analysis' },
    },
    // Original copywriting viewer — fed from the source so it shows the true original,
    // even though it sits visually after the analyst.
    { id: 'original-copy', type: 'originalCopy', position: { x: 880, y: 360 }, data: {} },
    // Improve — sees both the analyst's breakdown and the original caption.
    {
      id: 'improve',
      type: 'aiAgentConversation',
      position: { x: 880, y: 40 },
      data: { profileId: 'claude-research', prompt: IMPROVE_PROMPT, titleTemplate: 'Improved Copy' },
    },
    // Review — a human approves or rejects the rewritten copy.
    {
      id: 'review',
      type: 'humanApproval',
      position: { x: 1320, y: 40 },
      data: { title: 'Review improved copy', instructions: 'Approve to finalize the rewritten caption, or reject to discard.' },
    },
    // Final approved copy, rendered as markdown.
    { id: 'final-copy', type: 'markdownDisplay', position: { x: 1760, y: 40 }, data: {} },
  ],
  edges: [
    { id: 'e-src-analyst',  source: 'ig-source', target: 'analyst',       sourceHandle: OUT, targetHandle: IN },
    { id: 'e-src-original', source: 'ig-source', target: 'original-copy', sourceHandle: OUT, targetHandle: IN },
    { id: 'e-src-improve',  source: 'ig-source', target: 'improve',       sourceHandle: OUT, targetHandle: IN },
    { id: 'e-analyst-improve', source: 'analyst', target: 'improve',      sourceHandle: OUT, targetHandle: IN },
    { id: 'e-improve-review',  source: 'improve', target: 'review',       sourceHandle: OUT, targetHandle: IN },
    { id: 'e-review-final', source: 'review', target: 'final-copy',       sourceHandle: APPROVED, targetHandle: IN },
  ],
} as const

export interface BuiltinWorkflow {
  id: string
  name: string
  description: string
  graph: string
}

export const BUILTIN_WORKFLOWS: BuiltinWorkflow[] = [
  {
    id: 'builtin-ig-content-pipeline',
    name: 'IG Content Pipeline',
    description: 'Analyze a post, improve its copy, then review before publishing. Set the Instagram Post URL to run.',
    graph: JSON.stringify(IG_CONTENT_PIPELINE_GRAPH),
  },
]
