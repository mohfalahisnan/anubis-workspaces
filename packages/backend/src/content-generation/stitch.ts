import type { ContentPipeline, DraftOutput, GenerationTask } from '@anubis/shared'

export interface StitchInput {
  pipeline: ContentPipeline
  tasks: GenerationTask[]
  sourceRef: DraftOutput['sourceRef']
  lessonsUsed: string[]
  now: number
}

export function stitchDraft(input: StitchInput): DraftOutput {
  const { pipeline, tasks } = input
  const refined = pipeline.refinedContent

  const captionTask = tasks.find((t) => t.type === 'final_caption' && t.status === 'completed')
  const hashtagsTask = tasks.find((t) => t.type === 'final_hashtags' && t.status === 'completed')

  const finalCaption = captionTask?.output?.text ?? refined?.caption ?? ''
  const finalHashtags = hashtagsTask?.output?.text
    ? hashtagsTask.output.text.split(/\s+/).filter(Boolean)
    : refined
      ? [...refined.hashtags.primary, ...refined.hashtags.niche, ...refined.hashtags.brandSafe]
      : []

  const assets = tasks
    .filter((t) => (t.type === 'image' || t.type === 'carousel') && t.output?.assetPaths?.length)
    .map((t) => ({ type: t.type, paths: t.output!.assetPaths!, meta: t.output!.meta }))

  return {
    finalCaption,
    finalHashtags,
    assets,
    copywriting: refined?.copywriting,
    platformNotes: refined?.platformNotes,
    sourceRef: input.sourceRef,
    generationMeta: tasks.map((t) => ({ taskId: t.id, type: t.type, generator: t.generator, status: t.status })),
    reviewHistory: { aiReview: pipeline.aiReview, humanReview: pipeline.humanReview },
    lessonsUsed: input.lessonsUsed,
    generationLogs: tasks.map((t) => ({ taskId: t.id, type: t.type, status: t.status, error: t.error })),
    stitchedAt: input.now,
  }
}
