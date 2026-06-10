import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'
import { MODELS, DEFAULT_MODEL } from '../../src/agents/catalog.js'
import {
  applyModelOverrides,
  loadCatalogModels,
  type CatalogModels,
} from '../../src/agents/catalog-overrides.js'

function base(): CatalogModels {
  return { models: MODELS, defaultModel: DEFAULT_MODEL }
}

describe('applyModelOverrides', () => {
  it('returns the base catalog when the override is not an object', () => {
    expect(applyModelOverrides(base(), null)).toEqual(base())
    expect(applyModelOverrides(base(), 'nope')).toEqual(base())
    expect(applyModelOverrides(base(), [1, 2])).toEqual(base())
  })

  it('replaces an agent model list and leaves the others untouched', () => {
    const out = applyModelOverrides(base(), {
      models: {
        claude: [
          { id: 'claude-fable-5', category: 'recommended', description: 'Newest.' },
        ],
      },
    })
    expect(out.models.claude).toEqual([
      { id: 'claude-fable-5', category: 'recommended', description: 'Newest.' },
    ])
    expect(out.models.codex).toEqual(MODELS.codex)
    expect(out.models.antigravity).toEqual(MODELS.antigravity)
  })

  it('fills missing category/description and coerces unknown categories', () => {
    const out = applyModelOverrides(base(), {
      models: {
        claude: [
          { id: 'model-a' },
          { id: 'model-b', category: 'shiny-new-tier', description: 'B.' },
        ],
      },
    })
    expect(out.models.claude).toEqual([
      { id: 'model-a', category: 'alternative', description: '' },
      { id: 'model-b', category: 'alternative', description: 'B.' },
    ])
  })

  it('skips entries without a string id and keeps the built-in list when none survive', () => {
    const out = applyModelOverrides(base(), {
      models: {
        claude: [{ category: 'recommended' }, { id: 42 }, 'plain-string'],
      },
    })
    expect(out.models.claude).toEqual(MODELS.claude)
  })

  it('ignores unknown agent keys', () => {
    const out = applyModelOverrides(base(), {
      models: { 'not-an-agent': [{ id: 'x' }] },
    })
    expect(out).toEqual(base())
    expect('not-an-agent' in out.models).toBe(false)
  })

  it('applies per-agent defaultModel overrides and ignores non-strings', () => {
    const out = applyModelOverrides(base(), {
      defaultModel: { claude: 'claude-fable-5', codex: 42 },
    })
    expect(out.defaultModel.claude).toBe('claude-fable-5')
    expect(out.defaultModel.codex).toBe(DEFAULT_MODEL.codex)
  })

  it('does not mutate the base catalog', () => {
    const b = base()
    applyModelOverrides(b, {
      models: { claude: [{ id: 'other' }] },
      defaultModel: { claude: 'other' },
    })
    expect(b.models.claude).toEqual(MODELS.claude)
    expect(b.defaultModel.claude).toBe(DEFAULT_MODEL.claude)
  })
})

describe('loadCatalogModels', () => {
  let dir: string | null = null

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = null
  })

  it('merges overrides from {dataDir}/models.json', () => {
    dir = mkdtempSync(join(tmpdir(), 'anubis-models-'))
    writeFileSync(
      join(dir, 'models.json'),
      JSON.stringify({
        models: { claude: [{ id: 'claude-fable-5', category: 'recommended' }] },
        defaultModel: { claude: 'claude-fable-5' },
      }),
    )
    const out = loadCatalogModels(dir)
    expect(out.models.claude.map((m) => m.id)).toEqual(['claude-fable-5'])
    expect(out.defaultModel.claude).toBe('claude-fable-5')
    expect(out.models.codex).toEqual(MODELS.codex)
  })

  it('returns the built-in catalog when the file is missing', () => {
    dir = mkdtempSync(join(tmpdir(), 'anubis-models-'))
    expect(loadCatalogModels(dir)).toEqual(base())
  })

  it('returns the built-in catalog when the file is malformed', () => {
    dir = mkdtempSync(join(tmpdir(), 'anubis-models-'))
    writeFileSync(join(dir, 'models.json'), '{ not json')
    expect(loadCatalogModels(dir)).toEqual(base())
  })
})
