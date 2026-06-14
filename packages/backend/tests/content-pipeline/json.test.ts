import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { extractJson, runStructured } from '../../src/content-pipeline/json.js'

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
  it('throws after the retry also fails, surfacing the agent output', async () => {
    const runner = vi.fn().mockResolvedValue('Failed to authenticate. API Error: 401')
    await expect(runStructured(runner, { prompt: 'p', schema: Schema }))
      .rejects.toThrow(/AI step did not return valid JSON.*Failed to authenticate/s)
    expect(runner).toHaveBeenCalledTimes(2)
  })
})
