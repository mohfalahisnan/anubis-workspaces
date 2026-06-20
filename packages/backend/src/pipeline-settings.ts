import { Hono } from 'hono'
import { z } from 'zod'
import { getStack } from './services.js'
import { DEFAULT_PROMPT_TEMPLATES } from './content-pipeline/prompts.js'

const StepSettingsSchema = z.object({
  promptTemplate: z.string().optional(),
  model: z.string().optional(),
  reasoningEffort: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxJsonAttempts: z.number().int().min(1).max(6).optional(),
}).strict()

const GenerationProfilesSchema = z.object({
  image: z.string().optional(),
  video: z.string().optional(),
}).strict()

const SettingsBody = z.object({
  steps: z.object({
    brief: StepSettingsSchema.optional(),
    refine: StepSettingsSchema.optional(),
    ai_review: StepSettingsSchema.optional(),
  }),
  generationProfiles: GenerationProfilesSchema.optional(),
}).strict()

export const pipelineSettingsRoutes = new Hono()

pipelineSettingsRoutes.get('/', (c) => {
  const projectId = new URL(c.req.url).searchParams.get('projectId') ?? 'default'
  return c.json({
    ok: true,
    settings: getStack().contentPipelineSettings.get(projectId),
    defaults: DEFAULT_PROMPT_TEMPLATES,
  })
})

// Full-replace: both `steps` and `generationProfiles` are overwritten on every PUT,
// so callers must send both (an absent field resets to {}). The Content Studio
// settings dialog always sends both.
pipelineSettingsRoutes.put('/', async (c) => {
  const projectId = new URL(c.req.url).searchParams.get('projectId') ?? 'default'
  const body = SettingsBody.parse(await c.req.json())
  return c.json({ ok: true, settings: getStack().contentPipelineSettings.put(projectId, body.steps, body.generationProfiles ?? {}) })
})
