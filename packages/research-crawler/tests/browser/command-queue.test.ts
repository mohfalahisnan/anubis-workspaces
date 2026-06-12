import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createCommandQueue } from '../../src/core/browser/command-queue.js'

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

test('runs tasks one at a time in FIFO order (no overlap)', async () => {
  const queue = createCommandQueue()
  const events: string[] = []
  const task = (name: string, ms: number) => () =>
    (async () => { events.push(`start:${name}`); await delay(ms); events.push(`end:${name}`); return name })()
  const results = await Promise.all([queue.run(task('a', 20)), queue.run(task('b', 1)), queue.run(task('c', 1))])
  assert.deepEqual(results, ['a', 'b', 'c'])
  assert.deepEqual(events, ['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c'])
})

test('a rejected task does not poison later tasks', async () => {
  const queue = createCommandQueue()
  const failing = queue.run(async () => { throw new Error('boom') })
  const ok = queue.run(async () => 'ok')
  await assert.rejects(failing, /boom/)
  assert.equal(await ok, 'ok')
})

test('returns each task its own result/rejection', async () => {
  const queue = createCommandQueue()
  assert.equal(await queue.run(async () => 42), 42)
})
