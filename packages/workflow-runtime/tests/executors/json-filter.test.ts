import { describe, it, expect } from 'vitest'
import { jsonFilterExecutor } from '../../src/executors/json-filter.js'
import type { JsonFilterConfig, JsonFilterRule } from '../../src/executors/json-filter.js'

const stubCtx = {
  crawler: { captureProfile: async () => ({ id: '', mediaUrls: [] }) },
  ocr: { extractFromImage: async () => '' },
  db: { getCapturedPost: async () => ({ id: '', mediaUrls: [] }) },
  fs: { writeRunArtifact: async () => '' },
  conversations: {
    createAndAwaitFirstTurn: async () => ({ conversationId: '', messageId: '', text: '' }),
    cancel: async () => {},
  },
  runId: 'r1',
  signal: new AbortController().signal,
  emit: () => {},
} as const

async function run(config: JsonFilterConfig, value: unknown) {
  return (await jsonFilterExecutor.run(
    { nodeId: 'n1', config, upstream: { source: { kind: 'json', value } }, downstream: [] },
    stubCtx,
  )) as { kind: 'json'; value: unknown[] }
}

/** Run against the default DATA fixture with a single rule + matchType 'all'. */
async function filterRule(rule: JsonFilterRule, value: unknown[] = DATA) {
  return run({ matchType: 'all', rules: [rule] }, value)
}

const DATA = [
  { name: 'alpha', count: 10, active: true, tags: ['x', 'y'], nested: { score: 5 } },
  { name: 'beta', count: 20, active: false, tags: ['y', 'z'], nested: { score: 15 } },
  { name: 'gamma', count: 30, active: true, tags: [], nested: { score: 25 } },
]

describe('jsonFilterExecutor', () => {
  it('returns { kind: "json", value } shape and keeps all when no rules', async () => {
    const out = await run({ matchType: 'all', rules: [] }, DATA)
    expect(out.kind).toBe('json')
    expect(out.value).toEqual(DATA)
  })

  describe('strings', () => {
    it('equals / not_equals', async () => {
      expect((await filterRule({ field: 'name', operator: 'equals', value: 'beta' })).value).toEqual([DATA[1]])
      expect((await filterRule({ field: 'name', operator: 'not_equals', value: 'beta' })).value).toEqual([DATA[0], DATA[2]])
    })

    it('contains / not_contains on substrings', async () => {
      expect((await filterRule({ field: 'name', operator: 'contains', value: 'amm' })).value).toEqual([DATA[2]])
      // every name contains 'a'
      expect((await filterRule({ field: 'name', operator: 'not_contains', value: 'a' })).value).toEqual([])
    })

    it('starts_with / ends_with', async () => {
      expect((await filterRule({ field: 'name', operator: 'starts_with', value: 'al' })).value).toEqual([DATA[0]])
      expect((await filterRule({ field: 'name', operator: 'ends_with', value: 'a' })).value).toEqual([DATA[0], DATA[1], DATA[2]])
    })

    it('regex', async () => {
      expect((await filterRule({ field: 'name', operator: 'regex', value: '^(alpha|gamma)$' })).value).toEqual([DATA[0], DATA[2]])
    })

    it('throws on invalid regex', async () => {
      await expect(filterRule({ field: 'name', operator: 'regex', value: '(' })).rejects.toThrow(/invalid regex/i)
    })
  })

  describe('numbers', () => {
    it('greater_than / greater_than_or_equal', async () => {
      expect((await filterRule({ field: 'count', operator: 'greater_than', value: 10 })).value).toEqual([DATA[1], DATA[2]])
      expect((await filterRule({ field: 'count', operator: 'greater_than_or_equal', value: 20 })).value).toEqual([DATA[1], DATA[2]])
    })

    it('less_than / less_than_or_equal', async () => {
      expect((await filterRule({ field: 'count', operator: 'less_than', value: 30 })).value).toEqual([DATA[0], DATA[1]])
      expect((await filterRule({ field: 'count', operator: 'less_than_or_equal', value: 10 })).value).toEqual([DATA[0]])
    })

    it('coerces string rule values to numbers for comparison + equality', async () => {
      expect((await filterRule({ field: 'count', operator: 'equals', value: '20' })).value).toEqual([DATA[1]])
      expect((await filterRule({ field: 'count', operator: 'greater_than', value: '15' })).value).toEqual([DATA[1], DATA[2]])
    })
  })

  describe('arrays', () => {
    it('contains uses membership', async () => {
      expect((await filterRule({ field: 'tags', operator: 'contains', value: 'x' })).value).toEqual([DATA[0]])
    })

    it('not_contains uses membership', async () => {
      // only gamma has no 'y'
      expect((await filterRule({ field: 'tags', operator: 'not_contains', value: 'y' })).value).toEqual([DATA[2]])
    })

    it('is_empty matches empty arrays', async () => {
      expect((await filterRule({ field: 'tags', operator: 'is_empty' })).value).toEqual([DATA[2]])
    })
  })

  describe('booleans', () => {
    it('equals on boolean values', async () => {
      expect((await filterRule({ field: 'active', operator: 'equals', value: true })).value).toEqual([DATA[0], DATA[2]])
      expect((await filterRule({ field: 'active', operator: 'equals', value: false })).value).toEqual([DATA[1]])
    })
  })

  describe('nested fields', () => {
    it('resolves dot-notation paths', async () => {
      expect((await filterRule({ field: 'nested.score', operator: 'greater_than', value: 10 })).value).toEqual([DATA[1], DATA[2]])
    })

    it('exists is false for missing nested paths', async () => {
      expect((await filterRule({ field: 'nested.missing', operator: 'exists' })).value).toEqual([])
    })
  })

  describe('exists / is_empty', () => {
    const rows = [
      { a: 'present' },
      { a: '' },
      { a: null },
      { b: 1 },
    ]

    it('exists checks presence (null counts as missing)', async () => {
      const out = await run({ matchType: 'all', rules: [{ field: 'a', operator: 'exists' }] }, rows)
      expect(out.value).toEqual([rows[0], rows[1]])
    })

    it('is_empty matches empty string, null, and missing', async () => {
      const out = await run({ matchType: 'all', rules: [{ field: 'a', operator: 'is_empty' }] }, rows)
      expect(out.value).toEqual([rows[1], rows[2], rows[3]])
    })
  })

  describe('matchType', () => {
    it('all = AND', async () => {
      const out = await run({
        matchType: 'all',
        rules: [
          { field: 'active', operator: 'equals', value: true },
          { field: 'count', operator: 'greater_than', value: 15 },
        ],
      }, DATA)
      expect(out.value).toEqual([DATA[2]])
    })

    it('any = OR', async () => {
      const out = await run({
        matchType: 'any',
        rules: [
          { field: 'name', operator: 'equals', value: 'alpha' },
          { field: 'count', operator: 'greater_than', value: 25 },
        ],
      }, DATA)
      expect(out.value).toEqual([DATA[0], DATA[2]])
    })
  })

  describe('source handling', () => {
    it('plucks via sourcePath', async () => {
      const out = await jsonFilterExecutor.run(
        {
          nodeId: 'n1',
          config: { matchType: 'all', sourcePath: 'source.value.items', rules: [{ field: 'count', operator: 'greater_than', value: 1 }] },
          upstream: { source: { kind: 'json', value: { items: [{ count: 1 }, { count: 2 }] } } },
          downstream: [],
        },
        stubCtx,
      ) as { kind: 'json'; value: unknown[] }
      expect(out.value).toEqual([{ count: 2 }])
    })

    it('wraps a single object source into a 1-element list', async () => {
      const out = await run({ matchType: 'all', rules: [{ field: 'count', operator: 'equals', value: 5 }] }, { count: 5 } as unknown as unknown[])
      expect(out.value).toEqual([{ count: 5 }])
    })

    it('returns empty array when source path is missing', async () => {
      const out = await jsonFilterExecutor.run(
        {
          nodeId: 'n1',
          config: { matchType: 'all', sourcePath: 'source.value.nope', rules: [] },
          upstream: { source: { kind: 'json', value: {} } },
          downstream: [],
        },
        stubCtx,
      ) as { kind: 'json'; value: unknown[] }
      expect(out.value).toEqual([])
    })
  })

  it('validateConfig defaults matchType and rules', () => {
    const cfg = jsonFilterExecutor.validateConfig({})
    expect(cfg).toEqual({ matchType: 'all', rules: [] })
  })
})
