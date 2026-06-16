import { describe, expect, it } from 'vitest'
import { buildThreadStartParams } from '../../../src/agents/codex/run.js'

describe('buildThreadStartParams', () => {
  it('sends the sandbox preference under `sandboxPolicy` as a kebab-case string', () => {
    const params = buildThreadStartParams({ cwd: '/ws', sandboxMode: 'workspace-write' })
    // The codex 0.133 app-server expects `sandboxPolicy`. Using `sandbox`
    // (the old field) is silently dropped, so codex falls back to its config
    // default and our workspace-write request never takes effect.
    expect(params.sandboxPolicy).toBe('workspace-write')
    expect('sandbox' in params).toBe(false)
  })

  it('defaults sandboxPolicy to workspace-write when unspecified', () => {
    const params = buildThreadStartParams({ cwd: '/ws' })
    expect(params.sandboxPolicy).toBe('workspace-write')
  })

  it('passes read-only and danger-full-access through verbatim', () => {
    expect(buildThreadStartParams({ cwd: '/ws', sandboxMode: 'read-only' }).sandboxPolicy)
      .toBe('read-only')
    expect(buildThreadStartParams({ cwd: '/ws', sandboxMode: 'danger-full-access' }).sandboxPolicy)
      .toBe('danger-full-access')
  })

  it('carries cwd, approvalPolicy and reasoning effort', () => {
    const params = buildThreadStartParams({
      cwd: '/ws', approvalPolicy: 'never', reasoningEffort: 'high', model: 'gpt-x',
    })
    expect(params.cwd).toBe('/ws')
    expect(params.approvalPolicy).toBe('never')
    expect(params.modelReasoningEffort).toBe('high')
    expect(params.model).toBe('gpt-x')
  })
})
