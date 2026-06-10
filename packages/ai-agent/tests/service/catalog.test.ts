import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AiAgentService } from '../../src/service/ai-agent-service.js'
import { MODELS } from '../../src/agents/catalog.js'

const ORIG_ENV = { ...process.env }
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'anubis-catalog-'))
  process.env.ANUBIS_DATA_DIR = dir
})

afterEach(() => {
  process.env = { ...ORIG_ENV }
  rmSync(dir, { recursive: true, force: true })
})

describe('AiAgentService.catalog', () => {
  it('reflects models.json overrides without a restart', () => {
    const service = new AiAgentService()

    // No file yet → shipped catalog.
    expect(service.catalog().models.claude).toEqual(MODELS.claude)

    writeFileSync(
      join(dir, 'models.json'),
      JSON.stringify({
        models: { claude: [{ id: 'claude-fable-5', category: 'recommended' }] },
        defaultModel: { claude: 'claude-fable-5' },
      }),
    )

    const catalog = service.catalog()
    expect(catalog.models.claude.map((m) => m.id)).toEqual(['claude-fable-5'])
    expect(catalog.defaultModel.claude).toBe('claude-fable-5')
    expect(catalog.models.codex).toEqual(MODELS.codex)
  })
})
