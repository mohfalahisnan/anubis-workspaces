#!/usr/bin/env node
// Seeds a REAL content pipeline workflow into the Anubis SQLite. Idempotent —
// re-running first deletes any prior workflow with the same name.
//
// Usage:  node scripts/create-content-pipeline-workflow.mjs
//   Optional: ANUBIS_POST_ID=<captured_posts.id> to target a different post.
//
// Shape (matches the hand-drawn diagram, achievable subset):
//
//   Instagram Post ─▶ JSON Transformer ─┬─▶ Image/Video (save media) ─┐
//          │                            │                             ├─▶ AI: Analyze ─▶ MD
//          └─▶ Original Copy            └─────────────────────────────┘        │
//                                                                              ▼
//   (original caption) ───────────────────────────────────────────▶  AI: Improve ─▶ MD
//                                                                              │
//                                                                              ▼
//                                                                       AI: Review ─▶ Human Review
//
//   - OCR / Transcript nodes are intentionally skipped (per request): media is
//     saved, then passed toward the AI directly.
//   - "find similarity / knowledge base / lessons" is a PROMPT instruction on the
//     Improve agent (anubis-core retrieval node isn't wired yet + index is empty).
//   - Each AI Agent is an isolated conversation with a single, focused job.

import Database from 'better-sqlite3'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

// ----- Resolve the same anubis.db the running Electron app uses -------------
function candidateDataDirs() {
  if (process.env.ANUBIS_DATA_DIR) return [process.env.ANUBIS_DATA_DIR]
  const out = []
  if (process.platform === 'win32') {
    if (process.env.APPDATA) {
      out.push(join(process.env.APPDATA, 'Anubis', 'anubis'))     // packaged
      out.push(join(process.env.APPDATA, 'Electron', 'anubis'))   // `pnpm dev`
    }
    if (process.env.LOCALAPPDATA) {
      out.push(join(process.env.LOCALAPPDATA, 'Anubis', 'anubis'))
    }
  } else if (process.platform === 'darwin') {
    const home = homedir()
    if (home) {
      out.push(join(home, 'Library', 'Application Support', 'Anubis', 'anubis'))
      out.push(join(home, 'Library', 'Application Support', 'Electron', 'anubis'))
    }
  } else {
    if (process.env.XDG_DATA_HOME) out.push(join(process.env.XDG_DATA_HOME, 'anubis'))
    const home = homedir()
    if (home) {
      out.push(join(home, '.config', 'Anubis', 'anubis'))
      out.push(join(home, '.config', 'Electron', 'anubis'))
      out.push(join(home, '.local', 'share', 'anubis'))
    }
  }
  if (out.length === 0) out.push(join(tmpdir(), 'anubis'))
  return out
}

function resolveDataDir() {
  const candidates = candidateDataDirs()
  let best = null
  for (const dir of candidates) {
    const dbPath = join(dir, 'anubis.db')
    if (!existsSync(dbPath)) continue
    const mtime = statSync(dbPath).mtimeMs
    if (!best || mtime > best.mtime) best = { dir, dbPath, mtime }
  }
  if (best) return best
  const fallback = candidates[0]
  mkdirSync(fallback, { recursive: true })
  return { dir: fallback, dbPath: join(fallback, 'anubis.db'), mtime: 0 }
}

const { dir: dataDir, dbPath } = resolveDataDir()
console.log('[seed] Using dataDir:', dataDir)

const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.pragma('busy_timeout = 5000')

// ----- Pick a real captured post with a rich caption ------------------------
const WANTED = process.env.ANUBIS_POST_ID || 'e476761d-fe7e-4746-9a89-39746a6dde61'
let post = db
  .prepare('SELECT id, username, substr(caption,1,60) cap FROM captured_posts WHERE id = ?')
  .get(WANTED)
if (!post) {
  post = db
    .prepare("SELECT id, username, substr(caption,1,60) cap FROM captured_posts WHERE caption IS NOT NULL AND caption != '' ORDER BY likes DESC LIMIT 1")
    .get()
  if (!post) {
    console.error('[seed] No captured posts found — capture a post first, or set ANUBIS_POST_ID.')
    process.exit(1)
  }
  console.log('[seed] Wanted post not found; falling back to top post by likes.')
}
console.log(`[seed] Target post: ${post.id} (@${post.username}) — "${post.cap}…"`)

// ----- AI Agent prompts (each an isolated, single-responsibility job) --------
const ANALYZE_PROMPT = `You are a CONTENT ANALYST. This is your ONLY job — do not rewrite or improve the content.

You are given one Instagram post in the <context> blocks:
- \`extract-json\` holds the \`caption\`, engagement \`metrics\`, and saved \`mediaPaths\`.
- \`save-media\` references the saved cover image by file path.

Produce a markdown brief with these sections:
1. **What it's about** — topic, angle, and format (listicle, tutorial, hot take, …).
2. **Target audience** — who this is for.
3. **Pain / problem** — the problem or desire it taps into.
4. **Hook** — the opening line/visual and why it stops the scroll.
5. **Why it works** — engagement drivers (reference the metrics in context).
6. **Weaknesses / gaps** — what's missing or could be stronger.

Be specific and concise. Put the COMPLETE markdown brief in the \`text\` field of your output block.`

const IMPROVE_PROMPT = `You are a CONTENT STRATEGIST & WRITER. This is your ONLY job — create an improved version of the post.

Inputs (in the <context> blocks):
- The ANALYSIS brief from the previous agent (\`md-analysis\`).
- The ORIGINAL caption (\`extract-json\`).

In production you would ground this rewrite in ANUBIS-CORE (the brand-scoped content memory): retrieve the most similar winning scripts from the SIMILARITY index, the brand KNOWLEDGE BASE, and prior LESSONS/mistakes, then reuse their proven hooks, value framing, and CTA mechanics (never copy verbatim). The anubis-core retrieval step is not wired into this workflow yet and the index is currently empty, so for now:
- Proceed using the analysis brief + platform best practices, AND
- End with a section \`## Anubis-core hooks (to wire later)\` listing the EXACT lookups that should inform this rewrite once available (e.g. "similarity: claude-skills listicle", "knowledge: brand tone", "lessons: avoid X").

Deliver an improved Instagram post in markdown: a stronger **Hook**, a tightened **Body**, and a clear **CTA**. Keep the original topic and intent. Put the COMPLETE markdown (improved post + the anubis-core hooks section) in the \`text\` field.`

const REVIEW_PROMPT = `You are a CONTENT REVIEWER / VALIDATOR. This is your ONLY job — judge the improved content; do not rewrite it.

Inputs (in the <context> blocks):
- The IMPROVED post (\`md-improved\`).
- The original ANALYSIS brief (\`md-analysis\`).

Output a markdown report:
- First line EXACTLY: \`Verdict: APPROVED\` or \`Verdict: NEEDS REVISION\`.
- **Alignment** — does it serve the target audience and pain from the analysis?
- **Platform fit** — right for Instagram (hook-first, length, CTA)?
- **Quality checklist** — hook / clarity / value / CTA, each marked ✅ ⚠️ or ❌.
- **Required fixes** — concrete, only if NEEDS REVISION.

(In production a NEEDS REVISION verdict would loop back to the Improve step and write a lesson into anubis-core; that durable loop isn't built yet.) Put the COMPLETE markdown report in the \`text\` field.`

// ----- The graph ------------------------------------------------------------
const graph = {
  nodes: [
    {
      id: 'instagram-post',
      type: 'instagramPost',
      position: { x: 80, y: 320 },
      data: { title: 'Source Instagram Post', source: 'existing', postId: post.id },
    },
    {
      id: 'extract-json',
      type: 'jsonTransformer',
      position: { x: 460, y: 320 },
      data: {
        title: 'Extract Caption + Metrics',
        template: JSON.stringify({
          caption: '{{input.post.caption}}',
          mediaPaths: '{{input.post.mediaPaths}}',
          metrics: '{{input.post.metrics}}',
          rows: {
            $map: 'input.post.mediaPaths',
            template: { label: 'media', value: '{{item}}' },
          },
        }, null, 2),
      },
    },
    {
      id: 'save-media',
      type: 'imageVideo',
      position: { x: 860, y: 140 },
      data: { title: 'Save Post Media', source: 'upstream' },
    },
    {
      id: 'original-copy',
      type: 'originalCopy',
      position: { x: 860, y: 520 },
      data: { title: 'Original Post Copy' },
    },
    {
      id: 'ai-analyze',
      type: 'aiAgentConversation',
      position: { x: 1240, y: 320 },
      data: {
        title: 'Analyze Original Post',
        profileId: 'claude-research',
        reasoning: 'medium',
        titleTemplate: 'Pipeline · Analyze',
        prompt: ANALYZE_PROMPT,
      },
    },
    {
      id: 'md-analysis',
      type: 'markdownDisplay',
      position: { x: 1620, y: 320 },
      data: { title: 'Analysis Brief' },
    },
    {
      id: 'ai-improve',
      type: 'aiAgentConversation',
      position: { x: 2000, y: 320 },
      data: {
        title: 'Improve Post Copy',
        profileId: 'claude-research',
        reasoning: 'medium',
        titleTemplate: 'Pipeline · Improve',
        prompt: IMPROVE_PROMPT,
      },
    },
    {
      id: 'md-improved',
      type: 'markdownDisplay',
      position: { x: 2380, y: 320 },
      data: { title: 'Improved Draft' },
    },
    {
      id: 'md-final-improved',
      type: 'markdownDisplay',
      position: { x: 2760, y: 140 },
      data: { title: 'Final Improved Content' },
    },
    {
      id: 'ai-review',
      type: 'aiAgentConversation',
      position: { x: 2760, y: 320 },
      data: {
        title: 'Review Improved Copy',
        profileId: 'claude-research',
        reasoning: 'medium',
        titleTemplate: 'Pipeline · Review',
        prompt: REVIEW_PROMPT,
      },
    },
    {
      id: 'human-approval',
      type: 'humanApproval',
      position: { x: 3140, y: 320 },
      data: {
        title: 'Human Review',
        instructions: 'Approve to publish, or reject to send a lesson back to the Improve agent.',
        maxIterations: 3,
      },
    },
    {
      id: 'md-final',
      type: 'markdownDisplay',
      position: { x: 3560, y: 180 },
      data: { title: 'Approved Final Copy' },
    },
    {
      id: 'lesson-approved',
      type: 'lessonWriter',
      position: { x: 3560, y: 440 },
      data: { title: 'Save Winning Lesson', profileId: 'claude-research', reasoning: 'medium', lessonType: 'lesson' },
    },
    {
      id: 'lesson-rejected',
      type: 'lessonWriter',
      position: { x: 3140, y: 620 },
      data: { title: 'Save Rejection Lesson', profileId: 'claude-research', reasoning: 'medium', lessonType: 'mistake' },
    },
  ],
  edges: [
    { id: 'e-ig-extract',        source: 'instagram-post', target: 'extract-json' },
    { id: 'e-ig-original',       source: 'instagram-post', target: 'original-copy' },
    { id: 'e-extract-media',     source: 'extract-json',   target: 'save-media' },
    { id: 'e-extract-analyze',   source: 'extract-json',   target: 'ai-analyze' },
    { id: 'e-media-analyze',     source: 'save-media',     target: 'ai-analyze' },
    { id: 'e-analyze-md',        source: 'ai-analyze',     target: 'md-analysis' },
    { id: 'e-md-improve',        source: 'md-analysis',    target: 'ai-improve' },
    { id: 'e-extract-improve',   source: 'extract-json',   target: 'ai-improve' },
    { id: 'e-improve-md',        source: 'ai-improve',     target: 'md-improved' },
    { id: 'e-md-review',         source: 'md-improved',    target: 'ai-review' },
    { id: 'e-md-final-improved', source: 'md-improved',    target: 'md-final-improved' },
    { id: 'e-analysis-review',   source: 'md-analysis',    target: 'ai-review' },
    { id: 'e-final-improved-approval', source: 'md-final-improved', target: 'human-approval' },
    { id: 'e-review-approval',   source: 'ai-review',      target: 'human-approval' },
    // approved → publish + capture "what good looks like"
    { id: 'e-approve-final',     source: 'human-approval', target: 'md-final',         sourceHandle: 'approved' },
    { id: 'e-approve-lesson',    source: 'human-approval', target: 'lesson-approved',  sourceHandle: 'approved' },
    // rejected → write a "what to avoid" lesson, then loop back into Improve
    { id: 'e-reject-lesson',     source: 'human-approval', target: 'lesson-rejected',  sourceHandle: 'rejected' },
    { id: 'e-lesson-loop',       source: 'lesson-rejected', target: 'ai-improve',      data: { loop: true } },
  ],
}

const NAME = 'Real: IG content pipeline (analyze → improve → review)'
const DESCRIPTION =
  'Real captured Instagram post → JSON Transformer → save media, then three ISOLATED AI agents: ' +
  'Analyze (topic/target/pain/hook/weaknesses) → Improve (rewrite) → Review (validation + verdict) ' +
  '→ Human Review. Approved → Markdown + a "what worked" lesson; rejected → a "what to avoid" lesson that loops ' +
  'back into Improve (bounded to 3 iterations). Each markdown checkpoint is shown between agents.'

const removed = db.prepare('DELETE FROM workflows WHERE name = ?').run(NAME)
if (removed.changes > 0) console.log(`[seed] Replaced ${removed.changes} prior copy of this workflow.`)

const id = randomUUID()
const now = Date.now()
const graphJson = JSON.stringify(graph)
db.prepare(
  `INSERT INTO workflows (id, name, description, draft_graph, published_graph,
                          draft_updated_at, published_at, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
).run(id, NAME, DESCRIPTION, graphJson, graphJson, now, now, now, now)

db.close()

console.log('[seed]', id, '→', NAME)
console.log('')
console.log('[seed] Done. In Anubis → Workflows, open it and click "▶ Run published".')
console.log('[seed] (If the Workflows page was already open, switch sidebar pages or press Ctrl+R to refresh.)')
