import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('backend smoke — profiles + conversation create', () => {
  beforeAll(() => {
    process.env.ANUBIS_DATA_DIR = mkdtempSync(join(tmpdir(), 'anubis-smoke-'))
  })
  afterAll(async () => {
    const { shutdownStack } = await import('../src/services.js')
    await shutdownStack()
  })

  it('GET /profiles lists the 5 builtin profiles', async () => {
    const { default: app } = await import('../src/app.js')
    const res = await app.request('/profiles')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: { id: string }[] }
    const ids = body.items.map(p => p.id)
    for (const id of ['claude-coding', 'claude-yolo', 'claude-research', 'codex-coding', 'codex-yolo']) {
      expect(ids).toContain(id)
    }
  })

  it('POST /conversations creates a conversation referencing a profile', async () => {
    const { default: app } = await import('../src/app.js')
    const res = await app.request('/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'smoke', profileId: 'claude-coding', workspacePath: process.cwd(),
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { conversation: { id: string; agent: string } }
    expect(body.conversation.agent).toBe('claude')
  })

  it('GET /skills returns the cron-helper builtin', async () => {
    const { default: app } = await import('../src/app.js')
    const res = await app.request('/skills')
    const body = (await res.json()) as { items: { name: string }[] }
    expect(body.items.some(s => s.name === 'cron-helper')).toBe(true)
  })
})
