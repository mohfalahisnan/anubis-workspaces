import { describe, it, expect, vi } from 'vitest'
import { aiAgentExecutor } from '../../src/executors/ai-agent.js'

function ctxWithAgent(agentRun: (req: { profileId: string; reasoning: string; prompt: string }) => Promise<{ text: string }>) {
  return {
    agent: { run: agentRun },
    crawler: { captureProfile: async () => ({ id: '', mediaUrls: [] }) },
    ocr: { extractFromImage: async () => '' },
    db: { getCapturedPost: async () => ({ id: '', mediaUrls: [] }) },
    fs: { writeRunArtifact: async () => '' },
    runId: 'r1',
    signal: new AbortController().signal,
    emit: () => {},
  } as const
}

describe('aiAgentExecutor', () => {
  it('embeds upstream into a <context> block', async () => {
    const agentRun = vi.fn().mockResolvedValue({ text: 'agent reply' })
    const out = await aiAgentExecutor.run(
      {
        nodeId: 'n3',
        config: { profileId: 'p1', reasoning: 'medium', prompt: 'analyze' },
        upstream: { n1: { caption: 'hello' } },
      },
      ctxWithAgent(agentRun),
    )
    expect(agentRun).toHaveBeenCalledTimes(1)
    const call = agentRun.mock.calls[0]?.[0] as { profileId: string; reasoning: string; prompt: string }
    expect(call.profileId).toBe('p1')
    expect(call.reasoning).toBe('medium')
    expect(call.prompt).toMatch(/^<context>\n.*\n<\/context>\n\nanalyze$/s)
    expect(call.prompt).toContain('"caption": "hello"')
    expect(out).toEqual({ kind: 'text', text: 'agent reply' })
  })

  it('rejects invalid reasoning', () => {
    expect(() =>
      aiAgentExecutor.validateConfig({ profileId: 'p1', reasoning: 'bogus', prompt: 'x' }),
    ).toThrow()
  })
})
