import * as pty from 'node-pty'
import { TypedEmitter, type AgentEventMap } from '../../events/stream.js'
import { wrapPromptWithSystem } from '../wrap-system-prompt.js'
import { buildAntigravityArgs } from './build-args.js'
import { parseAntigravityOutput, tryParse, ingest, type ParsedAntigravityOutput } from './parser.js'
import { stripTerminalSequences } from './terminal.js'

export interface AntigravityRunOpts {
  workspaceId: string
  sessionId?: string
  /** Prior `agy` conversation id to resume via `--conversation`. */
  conversationId?: string
  cwd: string
  prompt: string
  model?: string
  yolo?: boolean
  appendSystemPrompt?: string
  extraEnv?: Record<string, string>
}

export interface AntigravityAgentOpts {
  command?: string
  env?: NodeJS.ProcessEnv
  /** Overrides the `--output-format` value; see ANUBIS_ANTIGRAVITY_OUTPUT_FORMAT. */
  outputFormat?: string | null
}

// A wide, tall terminal so agy doesn't hard-wrap long answer lines to the
// viewport width (which would inject spurious line breaks into the text).
const PTY_COLS = 1000
const PTY_ROWS = 50

/** Drop env entries with undefined values — node-pty wants Record<string,string>. */
function cleanEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}

/**
 * Drives the Antigravity CLI (`agy`) in non-interactive print mode.
 *
 * Unlike claude/codex, `agy -p` writes its response ONLY to a TTY — with a piped
 * stdout it detects a non-terminal and prints nothing (the run "succeeds" with
 * an empty message). So we spawn it under a pseudo-terminal (node-pty), buffer
 * the rendered output, strip the terminal control sequences, then emit the text
 * once the process exits.
 */
export class AntigravityAgent {
  constructor(private opts: AntigravityAgentOpts = {}) {}

  async run(
    opts: AntigravityRunOpts,
  ): Promise<{ emitter: TypedEmitter<AgentEventMap>; sessionId: string; cancel: () => void }> {
    const sessionId = opts.sessionId ?? ''
    const outputFormat =
      this.opts.outputFormat !== undefined
        ? this.opts.outputFormat
        : process.env.ANUBIS_ANTIGRAVITY_OUTPUT_FORMAT ?? undefined

    const args = buildAntigravityArgs({
      cwd: opts.cwd,
      prompt: wrapPromptWithSystem(opts.prompt, opts.appendSystemPrompt),
      conversationId: opts.conversationId,
      model: opts.model,
      yolo: opts.yolo,
      outputFormat,
    })

    const env = cleanEnv({
      ...(this.opts.env ?? process.env),
      ...(opts.extraEnv ?? {}),
    })
    const command =
      this.opts.command ?? process.env.ANUBIS_ANTIGRAVITY_COMMAND ?? 'agy'

    const emitter = new TypedEmitter<AgentEventMap>()

    // Guarantee exactly one terminal (done|error) event per run so consumers
    // that `await` the run never hang.
    let terminalEmitted = false
    emitter.on('done', () => { terminalEmitted = true })
    emitter.on('error', () => { terminalEmitted = true })

    let proc: pty.IPty
    try {
      proc = pty.spawn(command, args, {
        name: 'xterm-256color',
        cols: PTY_COLS,
        rows: PTY_ROWS,
        cwd: opts.cwd,
        env,
      })
    } catch (e) {
      // e.g. agy not found on PATH. Surface via the emitter so the caller's
      // stream relay reports it instead of throwing out of streamAgent.
      queueMicrotask(() => {
        if (!terminalEmitted) emitter.emit('error', { error: e as Error })
      })
      return { emitter, sessionId, cancel: () => {} }
    }

    // When the user hits Stop we kill the child; the exit handler then reports
    // a clean `cancelled` done instead of an error.
    let cancelled = false
    const cancel = () => {
      if (cancelled) return
      cancelled = true
      try { proc.kill() } catch { /* already gone */ }
    }

    // node-pty merges stdout+stderr into one data stream.
    let buf = ''
    let lastCleanedText = ''
    let processedLinesCount = 0
    let isJsonMode: boolean | null = null
    let emittedAny = false

    proc.onData((chunk) => {
      buf += chunk

      if (isJsonMode === null) {
        const cleaned = stripTerminalSequences(buf)
        const trimmed = cleaned.trim()
        if (trimmed.length > 0) {
          isJsonMode = trimmed.startsWith('{') || trimmed.startsWith('[')
        }
      }

      if (isJsonMode === true) {
        const lines = buf.split(/\r?\n/)
        // Process all completed lines
        while (processedLinesCount < lines.length - 1) {
          const rawLine = lines[processedLinesCount]
          processedLinesCount++
          if (rawLine === undefined) continue
          const cleanedLine = stripTerminalSequences(rawLine).trim()
          if (!cleanedLine) continue
          try {
            const parsed = JSON.parse(cleanedLine)
            if (parsed && typeof parsed === 'object') {
              const tempOut: ParsedAntigravityOutput = {
                events: [],
                sessionId: undefined,
                usageRaw: undefined,
                finishReason: undefined,
              }
              ingest(parsed, tempOut)
              if (tempOut.sessionId) {
                emitter.emit('session', { sessionId: tempOut.sessionId })
                emittedAny = true
              }
              for (const ev of tempOut.events) {
                if (ev.kind === 'partial') {
                  emitter.emit('partial', { deltaText: ev.text })
                } else if (ev.kind === 'tool_call') {
                  emitter.emit('tool_call', { name: ev.name, args: ev.args })
                } else {
                  emitter.emit('tool_result', {
                    name: ev.name,
                    result: ev.result,
                    isError: ev.isError,
                  })
                }
                emittedAny = true
              }
            }
          } catch {
            // Incomplete or single JSON object line, ignore for now
          }
        }
      } else if (isJsonMode === false) {
        const cleaned = stripTerminalSequences(buf, true)
        if (cleaned.length > lastCleanedText.length) {
          const delta = cleaned.slice(lastCleanedText.length)
          emitter.emit('partial', { deltaText: delta })
          lastCleanedText = cleaned
          emittedAny = true
        }
      }
    })

    proc.onExit(({ exitCode }) => {
      if (terminalEmitted) return
      if (cancelled) {
        emitter.emit('done', { finishReason: 'cancelled' })
        return
      }

      const text = stripTerminalSequences(buf)
      if (exitCode !== 0) {
        emitter.emit('error', {
          error: new Error(
            `agy exited with code ${exitCode}. Output: ${text.slice(-2000) || 'none'}`,
          ),
        })
        return
      }

      if (isJsonMode === true) {
        // Check if the whole output is a single JSON object or array.
        const trimmed = text.trim()
        const whole = tryParse(trimmed)
        if (whole && typeof whole === 'object') {
          if (!emittedAny) {
            const parsed = parseAntigravityOutput(text)
            if (parsed.sessionId) {
              emitter.emit('session', { sessionId: parsed.sessionId })
            }
            for (const ev of parsed.events) {
              if (ev.kind === 'partial') {
                emitter.emit('partial', { deltaText: ev.text })
              } else if (ev.kind === 'tool_call') {
                emitter.emit('tool_call', { name: ev.name, args: ev.args })
              } else {
                emitter.emit('tool_result', {
                  name: ev.name,
                  result: ev.result,
                  isError: ev.isError,
                })
              }
            }
            emitter.emit('done', {
              finishReason: parsed.finishReason ?? 'stop',
              usage: parsed.usageRaw,
            })
            return
          }
        }

        // Process any remaining lines (e.g. the last line without a trailing newline)
        const lines = buf.split(/\r?\n/)
        let finalUsageRaw: unknown = undefined
        let finalFinishReason: string | undefined = undefined
        for (let i = processedLinesCount; i < lines.length; i++) {
          const rawLine = lines[i]
          if (rawLine === undefined) continue
          const cleanedLine = stripTerminalSequences(rawLine).trim()
          if (!cleanedLine) continue
          try {
            const parsed = JSON.parse(cleanedLine)
            if (parsed && typeof parsed === 'object') {
              const tempOut: ParsedAntigravityOutput = {
                events: [],
                sessionId: undefined,
                usageRaw: undefined,
                finishReason: undefined,
              }
              ingest(parsed, tempOut)
              if (tempOut.sessionId) {
                emitter.emit('session', { sessionId: tempOut.sessionId })
              }
              if (tempOut.usageRaw) finalUsageRaw = tempOut.usageRaw
              if (tempOut.finishReason) finalFinishReason = tempOut.finishReason
              for (const ev of tempOut.events) {
                if (ev.kind === 'partial') {
                  emitter.emit('partial', { deltaText: ev.text })
                } else if (ev.kind === 'tool_call') {
                  emitter.emit('tool_call', { name: ev.name, args: ev.args })
                } else {
                  emitter.emit('tool_result', {
                    name: ev.name,
                    result: ev.result,
                    isError: ev.isError,
                  })
                }
              }
            }
          } catch {
            // ignore
          }
        }
        const parsed = parseAntigravityOutput(text)
        emitter.emit('done', {
          finishReason: finalFinishReason ?? parsed.finishReason ?? 'stop',
          usage: finalUsageRaw ?? parsed.usageRaw,
        })
      } else {
        // Plain text mode
        if (text.length > lastCleanedText.length) {
          const delta = text.slice(lastCleanedText.length)
          emitter.emit('partial', { deltaText: delta })
        }
        emitter.emit('done', {
          finishReason: 'stop',
        })
      }
    })

    return { emitter, sessionId, cancel }
  }
}
