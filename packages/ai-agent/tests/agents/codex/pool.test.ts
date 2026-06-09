import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../src/agents/process-tree.js', () => ({
  killProcessTree: vi.fn(),
}))

import { killProcessTree } from '../../../src/agents/process-tree.js'
import { CodexPool } from '../../../src/agents/codex/pool.js'

describe('CodexPool evict', () => {
  it('tree-kills the pooled child instead of a bare kill()', async () => {
    const child = { pid: 999, kill: vi.fn(), stdin: { end: vi.fn() } } as never
    const pool = new CodexPool({ idleMs: 10_000, spawn: () => child })
    await pool.acquire({ workspaceId: 'w', sessionId: 's' })

    pool.evict({ workspaceId: 'w', sessionId: 's' })

    expect(killProcessTree).toHaveBeenCalledWith(999)
  })

  it('passes extraEnv to the spawn callback', async () => {
    const child = { pid: 999, kill: vi.fn(), stdin: { end: vi.fn() } } as never
    const spawnSpy = vi.fn(() => child)
    const pool = new CodexPool({ idleMs: 10_000, spawn: spawnSpy })
    await pool.acquire({
      workspaceId: 'w',
      sessionId: 's',
      extraEnv: { MY_VAR: 'val' },
    })

    expect(spawnSpy).toHaveBeenCalledWith({
      workspaceId: 'w',
      sessionId: 's',
      extraEnv: { MY_VAR: 'val' },
    })
  })
})
