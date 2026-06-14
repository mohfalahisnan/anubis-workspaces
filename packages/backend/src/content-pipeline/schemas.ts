import { z } from 'zod'
import type { ContentLesson, ImprovedBrief, RawIdea, RefinedContent } from '@anubis/shared'
import {
  DEFAULT_PROMPT_TEMPLATES, renderPrompt,
  buildBriefVars, buildRefineVars, buildReviewVars,
} from './prompts.js'

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

/* Prompt builders delegate to the templated defaults (see prompts.ts). Pass an
   override `template` to render the same step variables into a custom prompt. */

export function buildBriefPrompt(input: {
  rawIdea: RawIdea
  context: string
  lessons: Array<Pick<ContentLesson, 'type' | 'howToImprove'>>
}, template?: string): string {
  return renderPrompt(template || DEFAULT_PROMPT_TEMPLATES.brief, buildBriefVars(input))
}

export function buildRefinePrompt(input: {
  brief: ImprovedBrief
  context: string
}, template?: string): string {
  return renderPrompt(template || DEFAULT_PROMPT_TEMPLATES.refine, buildRefineVars(input))
}

export function buildReviewPrompt(input: {
  refined: RefinedContent
  context: string
}, template?: string): string {
  return renderPrompt(template || DEFAULT_PROMPT_TEMPLATES.ai_review, buildReviewVars(input))
}
