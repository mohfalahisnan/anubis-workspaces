import { describe, it, expect } from 'vitest'

describe('node-pty smoke', () => {
  it('imports without throwing', async () => {
    const pty = await import('node-pty')
    expect(typeof pty.spawn).toBe('function')
  })
})
