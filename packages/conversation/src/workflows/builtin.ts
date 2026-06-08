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
const REJECTED = 'rejected'

const ANALYZE_PROMPT = [
  "You are a CONTENT ANALYST. This is your ONLY job — do not rewrite or improve the content.",
  "",
  "You are given one Instagram post in the <context> blocks:",
  "- `extract-json` holds the `caption`, engagement `metrics`, and saved `mediaPaths`.",
  "- `save-media` references the saved cover image by file path.",
  "",
  "Produce a markdown brief with these sections:",
  "1. **What it's about** — topic, angle, and format (listicle, tutorial, hot take, …).",
  "2. **Target audience** — who this is for.",
  "3. **Pain / problem** — the problem or desire it taps into.",
  "4. **Hook** — the opening line/visual and why it stops the scroll.",
  "5. **Why it works** — engagement drivers (reference the metrics in context).",
  "6. **Weaknesses / gaps** — what's missing or could be stronger.",
  "",
  "Be specific and concise. Put the COMPLETE markdown brief in the `text` field of your output block.",
].join('\n')

const IMPROVE_PROMPT = [
  "You are a CONTENT STRATEGIST & WRITER. This is your ONLY job — create an improved version of the post.",
  "",
  "Inputs (in the <context> blocks):",
  "- The ANALYSIS brief from the previous agent (`md-analysis`).",
  "- The ORIGINAL caption (`extract-json`).",
  "",
  "In production you would ground this rewrite in ANUBIS-CORE (the brand-scoped content memory): retrieve the most similar winning scripts from the SIMILARITY index, the brand KNOWLEDGE BASE, and prior LESSONS/mistakes, then reuse their proven hooks, value framing, and CTA mechanics (never copy verbatim). The anubis-core retrieval step is not wired into this workflow yet and the index is currently empty, so for now:",
  "- Proceed using the analysis brief + platform best practices, AND",
  "- End with a section `## Anubis-core hooks (to wire later)` listing the EXACT lookups that should inform this rewrite once available (e.g. \"similarity: claude-skills listicle\", \"knowledge: brand tone\", \"lessons: avoid X\").",
  "",
  "Deliver an improved Instagram post in markdown: a stronger **Hook**, a tightened **Body**, and a clear **CTA**. Keep the original topic and intent. Put the COMPLETE markdown (improved post + the anubis-core hooks section) in the `text` field.",
].join('\n')

const REVIEW_PROMPT = [
  "You are a CONTENT REVIEWER / VALIDATOR. This is your ONLY job — judge the improved content; do not rewrite it.",
  "",
  "Inputs (in the <context> blocks):",
  "- The IMPROVED post (`md-improved`).",
  "- The original ANALYSIS brief (`md-analysis`).",
  "",
  "Output a markdown report:",
  "- First line EXACTLY: `Verdict: APPROVED` or `Verdict: NEEDS REVISION`.",
  "- **Alignment** — does it serve the target audience and pain from the analysis?",
  "- **Platform fit** — right for Instagram (hook-first, length, CTA)?",
  "- **Quality checklist** — hook / clarity / value / CTA, each marked ✅ ⚠️ or ❌.",
  "- **Required fixes** — concrete, only if NEEDS REVISION.",
  "",
  "(In production a NEEDS REVISION verdict would loop back to the Improve step and write a lesson into anubis-core; that durable loop isn't built yet.) Put the COMPLETE markdown report in the `text` field.",
].join('\n')

const EXTRACT_JSON_TEMPLATE = [
  '{',
  '  "caption": "{{input.post.caption}}",',
  '  "mediaPaths": "{{input.post.mediaPaths}}",',
  '  "metrics": "{{input.post.metrics}}",',
  '  "rows": {',
  '    "$map": "input.post.mediaPaths",',
  '    "template": {',
  '      "label": "media",',
  '      "value": "{{item}}"',
  '    }',
  '  }',
  '}',
].join('\n')

/**
 * Real IG content pipeline: captured post → JSON extract + media save → three
 * isolated agents (Analyze → Improve → Review) → human approval. Approved →
 * markdown + "what worked" lesson; rejected → "what to avoid" lesson that
 * loops back into Improve (bounded by the human-approval iteration cap).
 */
const IG_CONTENT_PIPELINE_GRAPH = {
  nodes: [
    {
      id: 'instagram-post',
      type: 'instagramPost',
      position: { x: -811.5648434936217, y: 256.56067728273865 },
      data: {
        title: 'Instagram Post',
        source: 'url',
        url: '',
      },
    },
    {
      id: 'extract-json',
      type: 'jsonTransformer',
      position: { x: -109.67150385921953, y: 38.95456446554056 },
      data: {
        title: 'Extract Caption + Metrics',
        template: EXTRACT_JSON_TEMPLATE,
      },
    },
    {
      id: 'save-media',
      type: 'imageVideo',
      position: { x: 562, y: -574.25 },
      data: { title: 'Save Post Media', source: 'upstream' },
    },
    {
      id: 'original-copy',
      type: 'originalCopy',
      position: { x: -112.71274373538199, y: 537.0674547352778 },
      data: { title: 'Original Post Copy' },
    },
    {
      id: 'ai-analyze',
      type: 'aiAgentConversation',
      position: { x: 999.2825405555752, y: 419.9182227111222 },
      data: {
        title: 'Analyze Original Post',
        profileId: 'antigravity-yolo',
        reasoning: 'high',
        titleTemplate: 'Pipeline · Analyze',
        prompt: ANALYZE_PROMPT,
      },
    },
    {
      id: 'md-analysis',
      type: 'markdownDisplay',
      position: { x: 1484, y: -336 },
      data: { title: 'Analysis Brief' },
    },
    {
      id: 'ai-improve',
      type: 'aiAgentConversation',
      position: { x: 1935.1207095632624, y: 209.1906063399935 },
      data: {
        title: 'Improve Post Copy',
        profileId: 'antigravity-yolo',
        reasoning: 'medium',
        titleTemplate: 'Pipeline · Improve',
        prompt: IMPROVE_PROMPT,
      },
    },
    {
      id: 'md-improved',
      type: 'markdownDisplay',
      position: { x: 2449.432799961256, y: 307.9860106759779 },
      data: { title: 'Improved Draft' },
    },
    {
      id: 'ai-review',
      type: 'aiAgentConversation',
      position: { x: 2627.3211728073215, y: -347.48773323377384 },
      data: {
        title: 'Review Improved Copy',
        profileId: 'antigravity-yolo',
        reasoning: 'medium',
        titleTemplate: 'Pipeline · Review',
        prompt: REVIEW_PROMPT,
      },
    },
    {
      id: 'human-approval',
      type: 'humanApproval',
      position: { x: 3573.8529640175966, y: -184.4309333813584 },
      data: {
        title: 'Human Review',
        instructions: 'Approve to publish, or reject to send a lesson back to the Improve agent.',
        maxIterations: 3,
      },
    },
    {
      id: 'md-final',
      type: 'markdownDisplay',
      position: { x: 4593.88507774042, y: -309.39589612213 },
      data: { title: 'Approved Final Copy' },
    },
    {
      id: 'lesson-approved',
      type: 'lessonWriter',
      position: { x: 4437.886567572514, y: -726.6007517556573 },
      data: {
        title: 'Save Winning Lesson',
        profileId: 'claude-research',
        reasoning: 'medium',
        lessonType: 'lesson',
      },
    },
    {
      id: 'lesson-rejected',
      type: 'lessonWriter',
      position: { x: 3496.339179908387, y: 690.7917922442599 },
      data: {
        title: 'Save Rejection Lesson',
        profileId: 'claude-research',
        reasoning: 'medium',
        lessonType: 'mistake',
      },
    },
  ],
  edges: [
    { id: 'e-ig-extract',     source: 'instagram-post', target: 'extract-json',   sourceHandle: OUT, targetHandle: IN },
    { id: 'e-ig-original',    source: 'instagram-post', target: 'original-copy',  sourceHandle: OUT, targetHandle: IN },
    { id: 'e-extract-media',  source: 'extract-json',   target: 'save-media',    sourceHandle: OUT, targetHandle: IN },
    { id: 'e-extract-analyze',source: 'extract-json',   target: 'ai-analyze',    sourceHandle: OUT, targetHandle: IN },
    { id: 'e-media-analyze',  source: 'save-media',     target: 'ai-analyze',    sourceHandle: OUT, targetHandle: IN },
    { id: 'e-analyze-md',     source: 'ai-analyze',     target: 'md-analysis',   sourceHandle: OUT, targetHandle: IN },
    { id: 'e-md-improve',     source: 'md-analysis',    target: 'ai-improve',    sourceHandle: OUT, targetHandle: IN },
    { id: 'e-extract-improve',source: 'extract-json',   target: 'ai-improve',    sourceHandle: OUT, targetHandle: IN },
    { id: 'e-improve-md',     source: 'ai-improve',     target: 'md-improved',   sourceHandle: OUT, targetHandle: IN },
    { id: 'e-md-review',      source: 'md-improved',    target: 'ai-review',     sourceHandle: OUT, targetHandle: IN },
    { id: 'e-analysis-review',source: 'md-analysis',    target: 'ai-review',     sourceHandle: OUT, targetHandle: IN },
    { id: 'e-review-approval',source: 'ai-review',      target: 'human-approval',sourceHandle: OUT, targetHandle: IN, data: { loop: true } },
    { id: 'e-improved-approval', source: 'md-improved', target: 'human-approval',sourceHandle: OUT, targetHandle: IN, data: { loop: true } },
    { id: 'e-approval-final',    source: 'human-approval', target: 'md-final',         sourceHandle: APPROVED, targetHandle: IN },
    { id: 'e-approval-lesson',   source: 'human-approval', target: 'lesson-approved',  sourceHandle: APPROVED, targetHandle: IN },
    { id: 'e-reject-lesson',     source: 'human-approval', target: 'lesson-rejected',  sourceHandle: REJECTED, targetHandle: IN },
    { id: 'e-lesson-loop',       source: 'lesson-rejected', target: 'ai-improve',      sourceHandle: OUT, targetHandle: IN, data: { loop: true } },
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
    name: 'Real: IG content pipeline (analyze → improve → review)',
    description:
      'Captured Instagram post → JSON Transformer → save media, then three ISOLATED AI agents: Analyze → Improve → Review → Human Review. ' +
      'Approved → Markdown + a "what worked" lesson; rejected → a "what to avoid" lesson that loops back into Improve (bounded to 3 iterations). ' +
      'Set the Instagram Post URL to run.',
    graph: JSON.stringify(IG_CONTENT_PIPELINE_GRAPH),
  },
]
