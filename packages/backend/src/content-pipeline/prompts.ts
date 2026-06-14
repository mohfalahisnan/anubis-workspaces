import type { ContentLesson, ImprovedBrief, PipelinePromptDefaults, RawIdea, RefinedContent } from '@anubis/shared'

/* ============================================================
   Content-pipeline prompt templates.

   Each step ships a default template containing `{{placeholder}}`
   tokens that are interpolated with the step's runtime context.
   Users can override a template per project (see
   ContentPipelineSettingsRepo); overrides are rendered with the
   exact same variables, so a custom template can reference any of
   the documented placeholders below.

   `{{context}}` is the project knowledge-base context pack — brand
   guideline, niche positioning, similar winning content, etc. —
   retrieved per item from the anubis-engine index.
   ============================================================ */

const JSON_ONLY = 'Reply with ONLY a single JSON object matching the schema. No prose, no markdown fence.'

/**
 * Default templates. Placeholders:
 *  - brief:     {{source}} {{context}} {{lessons}}
 *  - refine:    {{brief}} {{context}}
 *  - ai_review: {{content}} {{context}}
 */
export const DEFAULT_PROMPT_TEMPLATES: PipelinePromptDefaults = {
  brief: [
    'You are a content strategist. Analyze the source content and produce an IMPROVED BRIEF for our brand.',
    '',
    'Answer internally: what is this about; topic; market fit; audience problem; information communicated; why it performed; angle/hook; emotional trigger; content structure; what we can adapt.',
    '',
    '=== SOURCE (raw idea) ===',
    '{{source}}',
    '',
    '=== BRAND & KNOWLEDGE CONTEXT ===',
    '{{context}}',
    '',
    '=== LESSONS FROM PAST MISTAKES (apply these) ===',
    '{{lessons}}',
    '',
    'Produce JSON with keys: coreIdea, targetAudience, marketFit, problem, mainMessage, contentAngle, hookDirection, brandAlignmentNotes, toneDirection, adaptationStrategy, riskNotes, referenceLessons (string[]).',
    JSON_ONLY,
  ].join('\n'),
  refine: [
    'Turn this brief into content-ready material for our brand.',
    '',
    '=== BRIEF ===',
    '{{brief}}',
    '',
    '=== BRAND & KNOWLEDGE CONTEXT ===',
    '{{context}}',
    '',
    'Produce JSON with keys:',
    'caption (string),',
    'visualBrief { concept, sceneDirection, subject, layout, mood, style, keyElements (string[]), textOverlay?, negativeDirection? },',
    'copywriting { hook, body, cta, textOverlay?, carouselSlides? (string[]), videoScript? },',
    'hashtags { primary (string[]), niche (string[]), brandSafe (string[]), platformNotes? },',
    'platformNotes?.',
    JSON_ONLY,
  ].join('\n'),
  ai_review: [
    'Review the refined content and decide if it is good enough to continue.',
    'Validate: niche alignment, brand alignment, tone of voice, content clarity, hook strength, message quality, audience relevance, visual brief quality, copywriting quality, similarity-to-competitor risk, hallucination risk, misleading-claim risk, weak-differentiation risk.',
    '',
    '=== CONTENT ===',
    '{{content}}',
    '',
    '=== BRAND & KNOWLEDGE CONTEXT ===',
    '{{context}}',
    '',
    'Decision MUST be exactly "approved" or "rejected".',
    'Produce JSON: { decision: "approved"|"rejected", score (0-100 number, optional), checklist: [{ criterion, pass (boolean), note? }], rejectionReason? (required if rejected), improvementInstruction? (required if rejected) }.',
    JSON_ONLY,
  ].join('\n'),
}

/** Replace `{{key}}` tokens with the provided values (missing keys → empty string). */
export function renderPrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => vars[key] ?? '')
}

/** The knowledge-base context pack, or a clear placeholder when nothing is indexed. */
function contextBlock(context: string | undefined): string {
  return context && context.trim() ? context.trim() : '(no project knowledge indexed for this item)'
}

function lessonsBlock(lessons: Array<Pick<ContentLesson, 'type' | 'howToImprove'>>): string {
  if (!lessons.length) return '(no prior lessons)'
  return lessons.map((l) => `- [${l.type}] ${l.howToImprove}`).join('\n')
}

function sourceBlock(rawIdea: RawIdea): string {
  return [
    `Caption: ${rawIdea.caption ?? ''}`,
    rawIdea.transcript ? `Transcript: ${rawIdea.transcript}` : '',
    `Platform: ${rawIdea.sourcePlatform ?? ''}`,
    `Source URL: ${rawIdea.sourceUrl ?? ''}`,
  ].filter(Boolean).join('\n')
}

export function buildBriefVars(input: {
  rawIdea: RawIdea
  context: string
  lessons: Array<Pick<ContentLesson, 'type' | 'howToImprove'>>
}): Record<string, string> {
  return {
    source: sourceBlock(input.rawIdea),
    context: contextBlock(input.context),
    lessons: lessonsBlock(input.lessons),
  }
}

export function buildRefineVars(input: { brief: ImprovedBrief; context: string }): Record<string, string> {
  return {
    brief: JSON.stringify(input.brief, null, 2),
    context: contextBlock(input.context),
  }
}

export function buildReviewVars(input: { refined: RefinedContent; context: string }): Record<string, string> {
  return {
    content: JSON.stringify(input.refined, null, 2),
    context: contextBlock(input.context),
  }
}
