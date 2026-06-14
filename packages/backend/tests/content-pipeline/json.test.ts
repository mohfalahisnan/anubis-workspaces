import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { extractJson, repairTruncatedJson, runStructured } from '../../src/content-pipeline/json.js'
import { AiReviewSchema } from '../../src/content-pipeline/schemas.js'

const Schema = z.object({ a: z.number(), b: z.string() })

describe('extractJson', () => {
  it('parses a fenced ```json block', () => {
    const text = 'prose\n```json\n{"a":1,"b":"x"}\n```\nmore'
    expect(extractJson(text, Schema)).toEqual({ a: 1, b: 'x' })
  })
  it('parses the first balanced object when unfenced', () => {
    expect(extractJson('Here: {"a":2,"b":"y"} done', Schema)).toEqual({ a: 2, b: 'y' })
  })
  it('throws on invalid shape', () => {
    expect(() => extractJson('{"a":"no"}', Schema)).toThrow()
  })
})

describe('repairTruncatedJson', () => {
  it('repairs the exact AI-review reply that was cut off mid-object', () => {
    const truncated = '{"decision":"approved","score":78,"checklist":[{"criterion":"Niche alignment","pass":true,"note":"clear and consistent"},{"criterion":"Brand alignment","pass":false,'
    const repaired = repairTruncatedJson(truncated)
    expect(repaired).not.toBeNull()
    const review = AiReviewSchema.parse(JSON.parse(repaired!))
    expect(review.decision).toBe('approved')
    expect(review.checklist).toHaveLength(2)
    expect(review.checklist[1]).toMatchObject({ criterion: 'Brand alignment', pass: false })
  })
  it('returns null when there is no object to repair', () => {
    expect(repairTruncatedJson('just prose, no braces')).toBeNull()
  })
})

describe('runStructured', () => {
  it('returns parsed output on first try', async () => {
    const runner = vi.fn().mockResolvedValue('```json\n{"a":1,"b":"x"}\n```')
    const out = await runStructured(runner, { prompt: 'p', schema: Schema })
    expect(out).toEqual({ a: 1, b: 'x' })
    expect(runner).toHaveBeenCalledTimes(1)
  })
  it('retries once on parse failure then succeeds', async () => {
    const runner = vi.fn()
      .mockResolvedValueOnce('garbage no json')
      .mockResolvedValueOnce('{"a":1,"b":"x"}')
    const out = await runStructured(runner, { prompt: 'p', schema: Schema })
    expect(out).toEqual({ a: 1, b: 'x' })
    expect(runner).toHaveBeenCalledTimes(2)
  })
  it('recovers a truncated reply locally without a second agent call', async () => {
    // Cut off mid-object with a trailing comma + unclosed array/object — the
    // exact AI-review failure shape. Repaired in-process, no extra round-trip.
    const runner = vi.fn().mockResolvedValue('{"a":1,"b":"hello world","extra":[1,2,')
    const out = await runStructured(runner, { prompt: 'p', schema: Schema })
    expect(out).toEqual({ a: 1, b: 'hello world' })
    expect(runner).toHaveBeenCalledTimes(1)
  })
  it('feeds the bad reply back when local repair cannot satisfy the schema', async () => {
    const bad = '{"a":"not-a-number'
    const runner = vi.fn()
      .mockResolvedValueOnce(bad)
      .mockResolvedValueOnce('{"a":1,"b":"x"}')
    const out = await runStructured(runner, { prompt: 'ORIGINAL', schema: Schema })
    expect(out).toEqual({ a: 1, b: 'x' })
    // The repair prompt re-sends the original instructions AND echoes the bad reply.
    const repairPrompt = runner.mock.calls[1]![0] as string
    expect(repairPrompt).toContain('ORIGINAL')
    expect(repairPrompt).toContain(bad)
  })
  it('retries up to 3 attempts before giving up, surfacing the agent output', async () => {
    const runner = vi.fn().mockResolvedValue('I am prose, not JSON')
    await expect(runStructured(runner, { prompt: 'p', schema: Schema }))
      .rejects.toThrow(/AI step did not return valid JSON after 3 attempts.*I am prose/s)
    expect(runner).toHaveBeenCalledTimes(3)
  })
  it('detects authentication errors and throws a clear message without retrying JSON parsing', async () => {
    const runner = vi.fn().mockResolvedValue('Failed to authenticate. API Error: 401 Invalid authentication credentials')
    await expect(runStructured(runner, { prompt: 'p', schema: Schema }))
      .rejects.toThrow(/Claude authentication failed/)
    expect(runner).toHaveBeenCalledTimes(1)
  })
})
