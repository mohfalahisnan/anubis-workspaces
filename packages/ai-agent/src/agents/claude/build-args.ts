export interface BuildClaudeArgsOpts {
  cwd: string
  prompt: string
  claudeResumeId?: string
  model?: string
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'
  allowedTools?: string[]
  disallowedTools?: string[]
  appendSystemPrompt?: string
}

export function buildClaudeArgs(opts: BuildClaudeArgsOpts): string[] {
  const args: string[] = [
    '-p',
    opts.prompt,
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
