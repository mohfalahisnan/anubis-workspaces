import { z } from 'zod'
import type { BrandContext, ContentLesson, ImprovedBrief, RawIdea, RefinedContent } from '@anubis/shared'

export const ImprovedBriefSchema: z.ZodType<ImprovedBrief> = z.object({
  coreIdea: z.string(),
  targetAudience: z.string(),
  marketFit: z.string(),
  problem: z.string(),
  mainMessage: z.string(),
  contentAngle: z.string(),
  hookDirection: z.string(),
  brandAlignmentNotes: z.string(),
  toneDirection: z.string(),
  adaptationStrategy: z.string(),
  riskNotes: z.string(),
  referenceLessons: z.array(z.string()).default([]),
})

export const RefinedContentSchema: z.ZodType<RefinedContent> = z.object({
  caption: z.string(),
  visualBrief: z.object({
    concept: z.string(),
    sceneDirection: z.string(),
    subject: z.string(),
    layout: z.string(),
    mood: z.string(),
    style: z.string(),
    keyElements: z.array(z.string()).default([]),
    textOverlay: z.string().optional(),
    negativeDirection: z.string().optional(),
  }),
  copywriting: z.object({
    hook: z.string(),
    body: z.string(),
    cta: z.string(),
    textOverlay: z.string().optional(),
    carouselSlides: z.array(z.string()).optional(),
    videoScript: z.string().optional(),
  }),
  hashtags: z.object({
    primary: z.array(z.string()).default([]),
    niche: z.array(z.string()).default([]),
    brandSafe: z.array(z.string()).default([]),
    platformNotes: z.string().optional(),
  }),
  platformNotes: z.string().optional(),
})

export const AiReviewSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  score: z.number().optional(),
  checklist: z.array(z.object({
    criterion: z.string(),
    pass: z.boolean(),
    note: z.string().optional(),
  })).default([]),
  rejectionReason: z.string().optional(),
  improvementInstruction: z.string().optional(),
})

type BrandLike = BrandContext | Partial<BrandContext> | undefined

function brandBlock(brand: BrandLike): string {
  if (!brand) return '(no brand context provided)'
  return [
    `Brand guideline: ${brand.brandGuideline ?? ''}`,
    `Tone of voice: ${brand.toneOfVoice ?? ''}`,
    `Target audience: ${brand.targetAudience ?? ''}`,
    `Niche positioning: ${brand.nichePositioning ?? ''}`,
    `Content rules: ${brand.contentRules ?? ''}`,
  ].join('\n')
}

function lessonsBlock(lessons: Array<Pick<ContentLesson, 'type' | 'howToImprove'>>): string {
  if (!lessons.length) return '(no prior lessons)'
  return lessons.map((l) => `- [${l.type}] ${l.howToImprove}`).join('\n')
}

const JSON_ONLY = 'Reply with ONLY a single JSON object matching the schema. No prose, no markdown fence.'

export function buildBriefPrompt(input: {
  rawIdea: RawIdea
  brand: BrandLike
  lessons: Array<Pick<ContentLesson, 'type' | 'howToImprove'>>
  kbHits: string[]
}): string {
  return [
    'You are a content strategist. Analyze the source content and produce an IMPROVED BRIEF for our brand.',
    '',
    'Answer internally: what is this about; topic; market fit; audience problem; information communicated; why it performed; angle/hook; emotional trigger; content structure; what we can adapt.',
    '',
    '=== SOURCE (raw idea) ===',
    `Caption: ${input.rawIdea.caption ?? ''}`,
    input.rawIdea.transcript ? `Transcript: ${input.rawIdea.transcript}` : '',
    `Platform: ${input.rawIdea.sourcePlatform ?? ''}`,
    `Source URL: ${input.rawIdea.sourceUrl ?? ''}`,
    '',
    '=== BRAND CONTEXT ===',
    brandBlock(input.brand),
    '',
    '=== LESSONS FROM PAST MISTAKES (apply these) ===',
    lessonsBlock(input.lessons),
    '',
    input.kbHits.length ? `=== KNOWLEDGE BASE ===\n${input.kbHits.join('\n')}` : '',
    '',
    'Produce JSON with keys: coreIdea, targetAudience, marketFit, problem, mainMessage, contentAngle, hookDirection, brandAlignmentNotes, toneDirection, adaptationStrategy, riskNotes, referenceLessons (string[]).',
    JSON_ONLY,
  ].filter(Boolean).join('\n')
}

export function buildRefinePrompt(input: {
  brief: ImprovedBrief
  brand: BrandLike
}): string {
  return [
    'Turn this brief into content-ready material for our brand.',
    '',
    '=== BRIEF ===',
    JSON.stringify(input.brief, null, 2),
    '',
    '=== BRAND CONTEXT ===',
    brandBlock(input.brand),
    '',
    'Produce JSON with keys:',
    'caption (string),',
    'visualBrief { concept, sceneDirection, subject, layout, mood, style, keyElements (string[]), textOverlay?, negativeDirection? },',
    'copywriting { hook, body, cta, textOverlay?, carouselSlides? (string[]), videoScript? },',
    'hashtags { primary (string[]), niche (string[]), brandSafe (string[]), platformNotes? },',
    'platformNotes?.',
    JSON_ONLY,
  ].join('\n')
}

export function buildReviewPrompt(input: {
  refined: RefinedContent
  brand: BrandLike
  niche?: string
}): string {
  return [
    'Review the refined content and decide if it is good enough to continue.',
    'Validate: niche alignment, brand alignment, tone of voice, content clarity, hook strength, message quality, audience relevance, visual brief quality, copywriting quality, similarity-to-competitor risk, hallucination risk, misleading-claim risk, weak-differentiation risk.',
    '',
    '=== CONTENT ===',
    JSON.stringify(input.refined, null, 2),
    '',
    '=== BRAND CONTEXT ===',
    brandBlock(input.brand),
    input.niche ? `Niche: ${input.niche}` : '',
    '',
    'Decision MUST be exactly "approved" or "rejected".',
    'Produce JSON: { decision: "approved"|"rejected", score (0-100 number, optional), checklist: [{ criterion, pass (boolean), note? }], rejectionReason? (required if rejected), improvementInstruction? (required if rejected) }.',
    JSON_ONLY,
  ].filter(Boolean).join('\n')
}
