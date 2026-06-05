export interface BuildAntigravityArgsOpts {
  cwd: string
  prompt: string
  conversationId?: string
  model?: string
  /**
   * Structured output format requested via `--output-format`. agy v1.x has no
   * such flag — print mode emits plain text, which the parser handles — so this
   * is OMITTED by default. Set it (via ANUBIS_ANTIGRAVITY_OUTPUT_FORMAT) only if
   * a future `agy` build adds structured output.
   */
  outputFormat?: string | null
  /** Auto-approve all tool permission prompts (`--dangerously-skip-permissions`). */
  yolo?: boolean
}

/**
 * Build the argv for a single non-interactive `agy` print-mode run.
 *
 * Unlike Claude Code, `agy` is documented to take the prompt as the value of
 * `-p`/`--print` (`agy -p "…"`), so we pass it as an argument rather than over
 * stdin. The shared spawn shim quotes multi-word args correctly across the
 * Windows `.cmd` boundary.
 */
export function buildAntigravityArgs(opts: BuildAntigravityArgsOpts): string[] {
  const args: string[] = ['--add-dir', opts.cwd]

  // Only emitted when explicitly opted in — agy v1.x rejects unknown flags.
  if (opts.outputFormat) args.push('--output-format', opts.outputFormat)

  if (opts.conversationId) args.push('--conversation', opts.conversationId)
  if (opts.model) args.push('--model', opts.model)
  if (opts.yolo) args.push('--dangerously-skip-permissions')

  // Keep `-p <prompt>` last so the prompt is unambiguously the print value.
  args.push('-p', opts.prompt)
  return args
}
