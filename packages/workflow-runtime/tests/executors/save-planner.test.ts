import { describe, it, expect } from 'vitest'
import { savePlannerExecutor } from '../../src/executors/save-planner.js'
import type { ExecutorContext } from '../../src/types.js'

function mockCtx(onSave?: (item: any) => void): ExecutorContext {
  return {
    runId: 'run-planner-123',
    signal: new AbortController().signal,
    emit: () => {},
    planner: {
      save: async (input: any) => {
        onSave?.(input)
        return { id: 'created-item-456' }
      },
    },
  } as unknown as ExecutorContext
}

describe('savePlannerExecutor', () => {
  it('saves item using template rendering for titles and briefs', async () => {
    let saved: any
    const out = await savePlannerExecutor.run(
      {
        nodeId: 'sp1',
        config: {
          projectId: 'my-project',
          title: 'Hello {{agent.name}}',
          rawBrief: 'Original: {{input.text}}',
          status: 'review',
        },
        upstream: {
          agent: { name: 'Anubis AI' },
          input: { text: 'Draft text here' },
        },
        downstream: [],
      },
      mockCtx((item) => {
        saved = item
      }),
    )

    expect(out).toEqual({
      kind: 'savePlanner',
      itemId: 'created-item-456',
      title: 'Hello Anubis AI',
      status: 'review',
    })

    expect(saved).toEqual({
      projectId: 'my-project',
      title: 'Hello Anubis AI',
      rawBrief: 'Original: Draft text here',
      improvedDraft: undefined,
      referencePostId: undefined,
      referenceUrl: undefined,
      status: 'review',
    })
  })

  it('performs fallback auto-detection when configuration is empty', async () => {
    let saved: any
    const out = await savePlannerExecutor.run(
      {
        nodeId: 'sp2',
        config: {
          status: 'idea',
        },
        upstream: {
          crawler: {
            kind: 'instagramPost',
            post: {
              id: 'ig-post-789',
              postUrl: 'https://instagram.com/p/ig-post-789',
            },
          },
          generator: {
            text: 'This is the generated caption for IG.',
          },
        },
        downstream: [],
      },
      mockCtx((item) => {
        saved = item
      }),
    )

    expect(out).toEqual({
      kind: 'savePlanner',
      itemId: 'created-item-456',
      title: 'This is the generated caption for IG.',
      status: 'idea',
    })

    expect(saved).toEqual({
      projectId: 'default',
      title: 'This is the generated caption for IG.',
      rawBrief: 'This is the generated caption for IG.',
      improvedDraft: undefined,
      referencePostId: 'ig-post-789',
      referenceUrl: 'https://instagram.com/p/ig-post-789',
      status: 'idea',
    })
  })

  it('validates config schema correctly', () => {
    expect(() => savePlannerExecutor.validateConfig({ status: 'bogus' })).toThrow()
    expect(() => savePlannerExecutor.validateConfig({ status: 'review', projectId: 'proj-1' })).not.toThrow()
  })
})
