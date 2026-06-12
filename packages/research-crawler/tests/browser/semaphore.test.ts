import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSemaphore } from '../../src/core/browser/semaphore.js'

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

test('never exceeds the configured max concurrent holders', async () => {
  const sem = createSemaphore(2)
  let active = 0
  let peak = 0
  const job = async () => {
    const release = await sem.acquire()
    active++
    peak = Math.max(peak, active)
    await delay(5)
    active--
    release()
  }
  await Promise.all(Array.from({ length: 6 }, () => job()))
  assert.equal(peak, 2)
})

test('exposes active count and releases let waiters through', async () => {
  const sem = createSemaphore(1)
  const r1 = await sem.acquire()
  assert.equal(sem.active, 1)
  let got = false
  const waiting = sem.acquire().then((r) => { got = true; return r })
  await delay(1)
  assert.equal(got, false)
  r1()
  const r2 = await waiting
  assert.equal(got, true)
  r2()
})
