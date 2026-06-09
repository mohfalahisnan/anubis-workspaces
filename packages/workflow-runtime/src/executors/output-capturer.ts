import { z } from 'zod'
import type { Executor, ExecutorContext, ExecutorInput } from '../types.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ConfigSchema = z.object({
  outputPath: z.string().optional(),
  filename: z.string().optional(),
  extension: z.enum(['md', 'json', 'txt']).optional(),
})

export type OutputCapturerConfig = z.infer<typeof ConfigSchema>

export type OutputCapturerOutput =
  | { filePath: string; filename: string; size: number }
  | { error: string }

function findUpstreamTitle(upstream: Record<string, unknown>): string | null {
  for (const value of Object.values(upstream)) {
    if (value && typeof value === 'object') {
      const title = (value as { title?: unknown }).title
      if (typeof title === 'string' && title.trim()) {
        return title.trim()
      }
    }
  }
  return null
}

function sanitizeFilenamePart(value: string): string {
  return value.replace(/[\/\\?%*:|"<>\x00-\x1f]/g, '-').trim()
}

function pickContent(upstream: Record<string, unknown>): unknown {
  const values = Object.values(upstream)
  return values.length === 1 ? values[0] : upstream
}

function serializeContent(content: unknown, ext: OutputCapturerConfig['extension']): string {
  if (ext === 'json') return JSON.stringify(content, null, 2)
  if (typeof content === 'string') return content
  return JSON.stringify(content, null, 2)
}

export const outputCapturerExecutor = {
  type: 'outputCapturer',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  async run(
    input: ExecutorInput<OutputCapturerConfig>,
    ctx: ExecutorContext,
  ): Promise<OutputCapturerOutput> {
    try {
      const ext = input.config.extension ?? 'json'
      const baseDir = ctx.workspacePath || process.cwd()
      const outputPath = input.config.outputPath?.trim() || path.join('.anubis', 'captures')
      const resolvedDir = path.isAbsolute(outputPath) ? outputPath : path.resolve(baseDir, outputPath)

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const title = sanitizeFilenamePart(findUpstreamTitle(input.upstream) || 'output') || 'output'

      const filenameTemplate = input.config.filename?.trim() || 'output-{timestamp}'
      const resolvedFilename = sanitizeFilenamePart(filenameTemplate
        .replace(/{timestamp}/g, timestamp)
        .replace(/{title}/g, title)) || `output-${timestamp}`

      const filenameWithExt = `${resolvedFilename}.${ext}`
      const fullPath = path.join(resolvedDir, filenameWithExt)
      const fileContent = serializeContent(pickContent(input.upstream), ext)

      mkdirSync(resolvedDir, { recursive: true })
      writeFileSync(fullPath, fileContent, 'utf-8')

      return {
        filePath: fullPath,
        filename: filenameWithExt,
        size: Buffer.byteLength(fileContent, 'utf8'),
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        error: message,
      }
    }
  },
} satisfies Executor<OutputCapturerConfig>
