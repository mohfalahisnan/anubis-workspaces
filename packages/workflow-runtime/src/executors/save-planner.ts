import { z } from 'zod'
import type { Executor } from '../types.js'

const ConfigSchema = z.object({
  projectId: z.string().optional(),
  title: z.string().optional(),
  rawBrief: z.string().optional(),
  improvedDraft: z.string().optional(),
  referencePostId: z.string().optional(),
  referenceUrl: z.string().optional(),
  status: z.enum(['idea', 'review', 'scheduled', 'published', 'rejected']).optional(),
})

export type SavePlannerConfig = z.infer<typeof ConfigSchema>

const TOKEN_RE = /\{\{([^}]+)\}\}/g

function resolvePath(root: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = root
  for (const part of parts) {
    if (current == null || typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
    if (current === undefined) return undefined
  }
  return current
}

function renderTemplate(template: string | undefined, upstream: Record<string, unknown>): string | undefined {
  if (!template) return undefined
  try {
    return template.replace(TOKEN_RE, (_, raw) => {
      const path = String(raw).trim()
      const value = resolvePath(upstream, path)
      if (value === undefined) return ''
      if (typeof value === 'string') return value
      return JSON.stringify(value)
    })
  } catch {
    return template
  }
}

function firstUpstreamString(upstream: Record<string, unknown>): string | null {
  for (const value of Object.values(upstream)) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (value && typeof value === 'object') {
      const t = (value as { text?: unknown }).text
      if (typeof t === 'string' && t.trim()) return t.trim()
    }
  }
  return null
}

export const savePlannerExecutor: Executor<SavePlannerConfig> = {
  type: 'savePlanner',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  async run(input, ctx) {
    if (!ctx.planner || typeof ctx.planner.save !== 'function') {
      throw new Error('savePlanner: planner save function is not available in execution context')
    }

    const projectId = input.config.projectId || 'default'
    const status = input.config.status || 'idea'

    // 1. Render inputs using templates if provided
    let referencePostId = renderTemplate(input.config.referencePostId, input.upstream)?.trim()
    let referenceUrl = renderTemplate(input.config.referenceUrl, input.upstream)?.trim()
    let title = renderTemplate(input.config.title, input.upstream)?.trim()
    let rawBrief = renderTemplate(input.config.rawBrief, input.upstream)?.trim()
    let improvedDraft = renderTemplate(input.config.improvedDraft, input.upstream)?.trim()

    // 2. Auto-detect fallbacks if not resolved by templates
    if (!referencePostId || !referenceUrl) {
      for (const value of Object.values(input.upstream)) {
        if (value && typeof value === 'object') {
          const val = value as { kind?: string; post?: { id?: string; postUrl?: string } }
          if (val.kind === 'instagramPost' && val.post) {
            if (!referencePostId && typeof val.post.id === 'string') {
              referencePostId = val.post.id
            }
            if (!referenceUrl && typeof val.post.postUrl === 'string') {
              referenceUrl = val.post.postUrl
            }
          }
        }
      }
    }

    if (!title) {
      // Find first upstream text/string, or use default
      const text = firstUpstreamString(input.upstream)
      if (text) {
        title = text.length > 50 ? `${text.slice(0, 47)}...` : text
      } else {
        title = `Planner Item - ${new Date().toLocaleDateString()}`
      }
    }

    if (!rawBrief) {
      // Find first upstream text output
      rawBrief = firstUpstreamString(input.upstream) || undefined
    }

    // Call the planner context method
    const result = await ctx.planner.save({
      projectId,
      referencePostId: referencePostId || undefined,
      referenceUrl: referenceUrl || undefined,
      title,
      status,
      rawBrief: rawBrief || undefined,
      improvedDraft: improvedDraft || undefined,
    })

    return {
      kind: 'savePlanner',
      itemId: result.id,
      title,
      status,
    }
  },
}
