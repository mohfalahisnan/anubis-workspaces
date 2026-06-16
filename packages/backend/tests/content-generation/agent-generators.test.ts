import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { AppConfig, GenerationTask } from '@anubis/shared'
import {
  AgentVideoGenerator, ConfigurableImageGenerator, FLOW_IMAGE_PROFILE_ID,
} from '../../src/content-generation/agent-generators.js'

const task = (over: Partial<GenerationTask> = {}): GenerationTask => ({
  id: 't1', contentId: 'c1', projectId: 'default', type: 'image', capability: 'image',
  generator: '', inputPrompt: 'a red cat', status: 'pending', retryCount: 0, createdAt: 1, updatedAt: 1, ...over,
})

function ctx(over: Partial<{ conversationId: string; onConversation: (id: string) => void }> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'anubis-gen-'))
  return {
    contentId: 'c1',
    projectId: 'default',
    workspaceDir: join(root, 'ws'),
    assetDir: join(root, 'ws', 'outputs', 'generated-assets', 'c1'),
    ...over,
  }
}

describe('ConfigurableImageGenerator', () => {
  it('runs the agent in the workspace dir and collects the image saved to the asset dir', async () => {
    const c = ctx()
    const runAgent = vi.fn(async () => {
      mkdirSync(c.assetDir, { recursive: true })
      writeFileSync(join(c.assetDir, 'out.png'), 'img')
      return { text: 'out.png', agent: 'codex' as const }
    })
    const gen = new ConfigurableImageGenerator({
      getConfig: () => ({} as AppConfig), runAgent, flow: { generate: vi.fn() } as never,
    })
    const out = await gen.generate(task(), c)
    expect(out.assetPaths!.length).toBe(1)
    expect(out.assetPaths![0]!.endsWith('out.png')).toBe(true)
    expect(out.assetPaths![0]!.startsWith(c.assetDir)).toBe(true)
    const input = runAgent.mock.calls[0]![0] as { profileId: string; prompt: string; title: string; cwd: string; projectId: string }
    expect(input.profileId).toBe('codex-image') // default when unset
    expect(input.prompt).toContain('$imagegen')
    expect(input.prompt).toContain(c.assetDir) // told where to save
    expect(input.cwd).toBe(c.workspaceDir) // runs in the workspace, not the asset dir
    expect(input.title).toContain('c1')
    expect(input.projectId).toBe('default')
  })

  it('forwards conversationId and onConversation from ctx to the runner', async () => {
    const onConversation = vi.fn()
    const c = ctx({ conversationId: 'conv-9', onConversation })
    const runAgent = vi.fn(async () => {
      mkdirSync(c.assetDir, { recursive: true })
      writeFileSync(join(c.assetDir, 'out.png'), 'img')
      return { text: 'out.png', agent: 'codex' as const }
    })
    const gen = new ConfigurableImageGenerator({
      getConfig: () => ({} as AppConfig), runAgent, flow: { generate: vi.fn() } as never,
    })
    await gen.generate(task(), c)
    const input = runAgent.mock.calls[0]![0] as { conversationId?: string; onConversation?: unknown }
    expect(input.conversationId).toBe('conv-9')
    expect(input.onConversation).toBe(onConversation)
  })

  it('delegates to Google Flow when the image profile is google-flow', async () => {
    const flowGenerate = vi.fn(async () => ({ assetPaths: ['/x/flow.png'] }))
    const runAgent = vi.fn()
    const gen = new ConfigurableImageGenerator({
      getConfig: () => ({ generationProfiles: { image: FLOW_IMAGE_PROFILE_ID } } as AppConfig),
      runAgent, flow: { generate: flowGenerate } as never,
    })
    const out = await gen.generate(task(), ctx())
    expect(flowGenerate).toHaveBeenCalled()
    expect(runAgent).not.toHaveBeenCalled()
    expect(out.assetPaths).toEqual(['/x/flow.png'])
  })

  it('throws when the agent produces no image file', async () => {
    const runAgent = vi.fn(async () => ({ text: 'done', agent: 'codex' as const }))
    const gen = new ConfigurableImageGenerator({
      getConfig: () => ({} as AppConfig), runAgent, flow: { generate: vi.fn() } as never,
    })
    await expect(gen.generate(task(), ctx())).rejects.toThrow(/no .*image/i)
  })
})

describe('AgentVideoGenerator', () => {
  it('runs the agent and collects the produced mp4 from the asset dir', async () => {
    const c = ctx()
    const runAgent = vi.fn(async () => {
      mkdirSync(c.assetDir, { recursive: true })
      writeFileSync(join(c.assetDir, 'reel.mp4'), 'vid')
      return { text: 'reel.mp4', agent: 'codex' as const }
    })
    const gen = new AgentVideoGenerator({ getConfig: () => ({} as AppConfig), runAgent })
    const out = await gen.generate(task({ type: 'video', capability: 'video', inputPrompt: 'a 5s promo' }), c)
    expect(out.assetPaths!.length).toBe(1)
    expect(out.assetPaths![0]!.endsWith('.mp4')).toBe(true)
    const input = runAgent.mock.calls[0]![0] as { profileId: string; prompt: string; cwd: string }
    expect(input.profileId).toBe('codex-video') // default when unset
    expect(input.prompt.toLowerCase()).toContain('hyperframes')
    expect(input.prompt).toContain(c.assetDir)
    expect(input.cwd).toBe(c.workspaceDir)
  })
})
