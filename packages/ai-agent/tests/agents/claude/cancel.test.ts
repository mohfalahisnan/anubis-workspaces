import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

vi.mock('../../../src/agents/spawn-shim.js', () => ({
  spawnNpmShim: vi.fn(),
}))
vi.mock('../../../src/agents/process-tree.js', () => ({
  killProcessTree: vi.fn(),
}))

import { spawnNpmShim } from '../../../src/agents/spawn-shim.js'
import { killProcessTree } from '../../../src/agents/process-tree.js'
import { ClaudeAgent } from '../../../src/agents/claude/runner.js'

function makeFakeChild() {
  const child = new EventEmitter() as never as {
    pid: number
    stdout: PassThrough
    stderr: PassThrough
    stdin: { end: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> }
    kill: ReturnType<typeof vi.fn>
    on: (ev: string, fn: (...a: never[]) => void) => void
  }
  child.pid = 4242
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.stdin = { end: vi.fn(), on: vi.fn() }
  child.kill = vi.fn()
  return child
}

describe('ClaudeAgent cancel', () => {
  it('tree-kills the process and emits a cancelled done immediately', async () => {
    const child = makeFakeChild()
    ;(spawnNpmShim as unknown as ReturnType<typeof vi.fn>).mockReturnValue(child)

    const agent = new ClaudeAgent({ command: 'claude.cmd' })
    const { emitter, cancel } = await agent.run({ workspaceId: 'w', cwd: '/tmp', prompt: 'hi' })

    const done = vi.fn()
    emitter.on('done', done)

    cancel()

    expect(killProcessTree).toHaveBeenCalledWith(4242)
    expect(done).toHaveBeenCalledWith({ finishReason: 'cancelled' })
  })
})
