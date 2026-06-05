import { describe, it, expect } from 'vitest'
import { buildAntigravityArgs } from '../../../src/agents/antigravity/build-args.js'

describe('buildAntigravityArgs', () => {
  it('omits --output-format by default (agy v1.x has no such flag)', () => {
    const args = buildAntigravityArgs({ cwd: '/work', prompt: 'hello world' })
    expect(args).toEqual([
      '--add-dir',
      '/work',
      '-p',
      'hello world',
    ])
    expect(args).not.toContain('--output-format')
  })

  it('emits --output-format only when explicitly opted in', () => {
    const args = buildAntigravityArgs({ cwd: '/work', prompt: 'hi', outputFormat: 'json' })
    expect(args).toContain('--output-format')
    expect(args[args.indexOf('--output-format') + 1]).toBe('json')
  })

  it('omits --output-format when explicitly disabled', () => {
    const args = buildAntigravityArgs({ cwd: '/work', prompt: 'hi', outputFormat: null })
    expect(args).not.toContain('--output-format')
  })

  it('adds --conversation, --model and --dangerously-skip-permissions', () => {
    const args = buildAntigravityArgs({
      cwd: '/work',
      prompt: 'hi',
      conversationId: 'abc-123',
      model: 'gemini-3.1-pro',
      yolo: true,
    })
    expect(args).toContain('--conversation')
    expect(args[args.indexOf('--conversation') + 1]).toBe('abc-123')
    expect(args).toContain('--model')
    expect(args[args.indexOf('--model') + 1]).toBe('gemini-3.1-pro')
    expect(args).toContain('--dangerously-skip-permissions')
  })

  it('always keeps -p and the prompt as the final pair', () => {
    const args = buildAntigravityArgs({
      cwd: '/work',
      prompt: 'do the thing',
      model: 'gemini-3.5-flash',
    })
    expect(args.slice(-2)).toEqual(['-p', 'do the thing'])
  })
})
