import type { ContentLesson, ImprovedBrief, PipelinePromptDefaults, RawIdea, RefinedContent } from '@anubis/shared'

/* ============================================================
   Content-pipeline prompt templates.

   Each step ships a default template containing `{{placeholder}}`
   tokens that are interpolated with the step's runtime context.
   Users can override a template per project (see
   ContentPipelineSettingsRepo); overrides are rendered with the
   exact same variables, so a custom template can reference any of
   the documented placeholders below.
   ============================================================ */

const JSON_ONLY = 'Reply with ONLY a single JSON object matching the schema. No prose, no markdown fence.'

/**
 * Default templates. Placeholders:
 *  - brief:     {{source}} {{media}} {{lessons}}
 *  - refine:    {{brief}}
 *  - ai_review: {{content}}
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
    '=== REFERENCE MEDIA ===',
    '{{media}}',
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
    'Decision MUST be exactly "approved" or "rejected".',
    'Produce JSON: { decision: "approved"|"rejected", score (0-100 number, optional), checklist: [{ criterion, pass (boolean), note? }], rejectionReason? (required if rejected), improvementInstruction? (required if rejected) }.',
    JSON_ONLY,
  ].join('\n'),
}

/** Replace `{{key}}` tokens with the provided values (missing keys → empty string). */
export function renderPrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => vars[key] ?? '')
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

function mediaBlock(rawIdea: RawIdea): string {
  const assets = rawIdea.localAssets ?? []
  if (!assets.length) return ''
  const images = assets.filter((a) => a.kind === 'image')
  const hasVideo = assets.some((a) => a.kind === 'video')
  // Video → analyze via transcript only (do not attach the file to the model).
  if (rawIdea.mediaKind === 'video' || (hasVideo && !images.length)) {
    return 'This is a VIDEO post. Analyze it from the transcript above only; no frames are attached.'
  }
  if (!images.length) return ''
  const list = images.map((a) => `- assets/${a.fileName}`).join('\n')
  return [
    `This is ${rawIdea.mediaKind === 'carousel' ? 'a CAROUSEL' : 'an IMAGE'} post. The following image file(s) are attached and also present in your working directory — open/read them and factor the visuals into the brief:`,
    list,
  ].join('\n')
}

export function buildBriefVars(input: {
  rawIdea: RawIdea
  lessons: Array<Pick<ContentLesson, 'type' | 'howToImprove'>>
}): Record<string, string> {
  return {
    source: sourceBlock(input.rawIdea),
    media: mediaBlock(input.rawIdea),
    lessons: lessonsBlock(input.lessons),
  }
}

export function buildRefineVars(input: { brief: ImprovedBrief }): Record<string, string> {
  return {
    brief: JSON.stringify(input.brief, null, 2),
  }
}

export function buildReviewVars(input: { refined: RefinedContent }): Record<string, string> {
  return {
    content: JSON.stringify(input.refined, null, 2),
  }
}
