export interface BuildClaudeArgsOpts {
  cwd: string
  claudeResumeId?: string
  model?: string
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'
  allowedTools?: string[]
  disallowedTools?: string[]
  appendSystemPrompt?: string
}

export function buildClaudeArgs(opts: BuildClaudeArgsOpts): string[] {
  // The prompt is written to stdin (see runner.ts), NOT passed as the
  // value of -p. On Windows the CLI is invoked via cmd.exe, which:
  //   - terminates the command line at the first literal newline, and
  //   - rejects command lines longer than ~8K chars.
  // Multi-line workflow prompts (XML <context> blocks, JSON, attached
  // files lists) trivially trip the newline limit. Passing -p with no
  // value tells Claude Code to read the prompt from stdin instead.
  const args: string[] = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--add-dir',
    opts.cwd,
  ]
  if (opts.claudeResumeId) args.push('--resume', opts.claudeResumeId)
  if (opts.model) args.push('--model', opts.model)
  if (opts.permissionMode) args.push('--permission-mode', opts.permissionMode)
  if (opts.allowedTools?.length) {
    args.push('--allowedTools', opts.allowedTools.join(','))
  }
  if (opts.disallowedTools?.length) {
    args.push('--disallowedTools', opts.disallowedTools.join(','))
  }
  if (opts.appendSystemPrompt && opts.appendSystemPrompt.trim() !== '') {
    args.push('--append-system-prompt', opts.appendSystemPrompt)
  }
  return args
}
