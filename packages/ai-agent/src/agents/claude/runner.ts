import type { Readable } from 'node:stream'
import split2 from 'split2'
import { parseStreamLine } from './parser.js'
import type { ContentBlock } from './types.js'
import { TypedEmitter, type AgentEventMap } from '../../events/stream.js'
import { buildClaudeArgs } from './build-args.js'
import { spawnNpmShim } from '../spawn-shim.js'

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
                isError: c.is_error === true,
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

    const command = this.opts.command ?? process.env.ANUBIS_CLAUDE_COMMAND ?? 'claude'
    // Use the shared shim helper so multi-word args (e.g. `-p` prompt with
    // spaces) survive intact through Windows .cmd shims — `shell: true`
    // would split them at the cmd.exe lexer because Node doesn't quote
    // args under shell:true.
    const child = spawnNpmShim(command, args, {
      env,
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const emitter = new TypedEmitter<AgentEventMap>()

    // Track whether a terminal event already fired so we can guarantee
    // exactly one done/error per run. Without this, a clean exit (code 0)
    // that produced no `result` line would leave consumers waiting forever
    // for a done event — that hangs anything that `await`s the run.
    let terminalEmitted = false
    emitter.on('done', () => { terminalEmitted = true })
    emitter.on('error', () => { terminalEmitted = true })

    let stderrData = ''
    let lastStdoutLine = ''
    child.stderr?.on('data', (chunk) => {
      stderrData += chunk.toString()
    })
    // Capture the tail of stdout too — claude sometimes writes a plain-text
    // error there (e.g. permission-mode incompatible with -p) before exiting
    // with a non-zero code and no stderr. Without this, the run UI shows a
    // useless "Stderr: none" message and the user has no way to diagnose.
    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString() as string
      const trimmed = text.trim()
      if (trimmed) lastStdoutLine = trimmed.slice(-2000)
    })
    child.on('close', (code) => {
      if (terminalEmitted) return
      if (code !== 0 && code !== null) {
        const stderr = stderrData.trim()
        const detail =
          stderr ||
          (lastStdoutLine ? `(no stderr; last stdout: ${lastStdoutLine})` : 'none')
        emitter.emit('error', {
          error: new Error(`Process exited with code ${code}. Stderr: ${detail}`),
        })
        return
      }
      // Clean exit (or killed: code === null) but no `result` line was
      // emitted on stdout. Surface this as an error rather than hanging
      // the consumer's `done` await indefinitely.
      const detail =
        stderrData.trim() ||
        lastStdoutLine ||
        '(no output)'
      emitter.emit('error', {
        error: new Error(`Process exited without emitting a result (code=${code}). Output: ${detail}`),
      })
    })
    child.on('error', (e) => {
      if (terminalEmitted) return
      emitter.emit('error', { error: e })
    })
    runClaudeStream({ stdout: child.stdout!, emitter }).catch((e) => {
      if (terminalEmitted) return
      emitter.emit('error', { error: e as Error })
    })

    return { emitter, sessionId }
  }
}
