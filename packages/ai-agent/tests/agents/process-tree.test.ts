import { describe, it, expect, vi } from 'vitest'
import { killProcessTree } from '../../src/agents/process-tree.js'

describe('killProcessTree', () => {
  it('runs `taskkill /pid <pid> /T /F` on Windows', () => {
    const spawn = vi.fn(() => ({ on: vi.fn() })) as never
    killProcessTree(4242, { platform: 'win32', spawn })
    expect(spawn).toHaveBeenCalledWith(
      'taskkill',
      ['/pid', '4242', '/T', '/F'],
      expect.objectContaining({ windowsHide: true }),
    )
  })

  it('sends SIGKILL to the pid on POSIX', () => {
    const kill = vi.fn()
    killProcessTree(7, { platform: 'linux', kill })
    expect(kill).toHaveBeenCalledWith(7, 'SIGKILL')
  })

  it('no-ops for an undefined or zero pid', () => {
    const spawn = vi.fn() as never
    const kill = vi.fn()
    killProcessTree(undefined, { platform: 'win32', spawn })
    killProcessTree(0, { platform: 'linux', kill })
    expect(spawn).not.toHaveBeenCalled()
    expect(kill).not.toHaveBeenCalled()
  })

  it('swallows errors thrown by the killer (process already gone)', () => {
    const spawn = vi.fn(() => { throw new Error('taskkill missing') }) as never
    expect(() => killProcessTree(1, { platform: 'win32', spawn })).not.toThrow()
    const kill = vi.fn(() => { throw new Error('ESRCH') })
    expect(() => killProcessTree(1, { platform: 'linux', kill })).not.toThrow()
  })
})
