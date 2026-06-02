import type { Readable } from 'node:stream'
import { spawn } from 'node:child_process'
import split2 from 'split2'
import { parseStreamLine } from './parser.js'
import type { ContentBlock } from './types.js'
import { TypedEmitter, type AgentEventMap } from '../../events/stream.js'
import { buildClaudeArgs } from './build-args.js'

export interface RunClaudeStreamOpts {
  stdout: Readable
  emitter: TypedEmitter<AgentEventMap>
}

export async function runClaudeStream(
  opts: RunClaudeStreamOpts,
): Promise<void> {
  const toolNamesById = new Map<string, string>()
  await new Promise<void>((resolve, reject) => {
    opts.stdout
      .pipe(split2())
      .on('data', (line: string) => {
        const ev = parseStreamLine(line)
        if (!ev) return
        if (ev.type === 'system' && ev.subtype === 'init' && ev.session_id) {
          opts.emitter.emit('session', { sessionId: ev.session_id })
        } else if (ev.type === 'assistant') {
          for (const c of ev.message.content as ContentBlock[]) {
            if (c.type === 'text') {
              opts.emitter.emit('partial', { deltaText: c.text })
            } else if (c.type === 'tool_use') {
              if (c.id) {
                toolNamesById.set(c.id, c.name)
              }
              opts.emitter.emit('tool_call', {
                name: c.name,
                args: c.input,
              })
            }
          }
        } else if (ev.type === 'user') {
          for (const c of ev.message.content as ContentBlock[]) {
            if (c.type === 'tool_result') {
              opts.emitter.emit('tool_result', {
                name: toolNamesById.get(c.tool_use_id) ?? c.tool_use_id,
                result: c.content,
              })
            }
          }
        } else if (ev.type === 'result') {
          opts.emitter.emit('done', {
            finishReason: ev.subtype,
            usage: ev,
          })
        }
      })
      .on('end', () => resolve())
      .on('error', reject)
  })
}

export interface ClaudeRunOpts {
  workspaceId: string
  sessionId?: string
  claudeResumeId?: string
  cwd: string
  prompt: string
  model?: string
  claudeCliProfile?: string
  extraEnv?: Record<string, string>
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'
  allowedTools?: string[]
  disallowedTools?: string[]
  appendSystemPrompt?: string
}

export interface ClaudeAgentOpts {
  command?: string
  env?: NodeJS.ProcessEnv
}

export class ClaudeAgent {
  constructor(private opts: ClaudeAgentOpts = {}) {}

  async run(
    opts: ClaudeRunOpts,
  ): Promise<{ emitter: TypedEmitter<AgentEventMap>; sessionId: string }> {
    const sessionId = opts.sessionId ?? ''
    const args = buildClaudeArgs({
      cwd: opts.cwd,
      prompt: opts.prompt,
      claudeResumeId: opts.claudeResumeId,
      model: opts.model,
      permissionMode: opts.permissionMode,
      allowedTools: opts.allowedTools,
      disallowedTools: opts.disallowedTools,
      appendSystemPrompt: opts.appendSystemPrompt,
    })
    const env = {
      ...(this.opts.env ?? process.env),
      ...(opts.extraEnv ?? {}),
    }

    const child = spawn(this.opts.command ?? process.env.ANUBIS_CLAUDE_COMMAND ?? 'claude', args, {
      env,
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const emitter = new TypedEmitter<AgentEventMap>()

    let stderrData = ''
    child.stderr?.on('data', (chunk) => {
      stderrData += chunk.toString()
    })
    child.on('close', (code) => {
      if (code !== 0 && code !== null) {
        emitter.emit('error', {
          error: new Error(`Process exited with code ${code}. Stderr: ${stderrData.trim() || 'none'}`),
        })
      }
    })
    child.on('error', (e) => emitter.emit('error', { error: e }))
    runClaudeStream({ stdout: child.stdout!, emitter }).catch((e) =>
      emitter.emit('error', { error: e as Error }),
    )

    return { emitter, sessionId }
  }
}
