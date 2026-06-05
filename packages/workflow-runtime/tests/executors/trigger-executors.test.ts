import { describe, it, expect } from 'vitest'
import { scheduleTriggerExecutor } from '../../src/executors/schedule-trigger.js'
import { fileWatchTriggerExecutor } from '../../src/executors/file-watch-trigger.js'

const ctx = {} as never
const base = { nodeId: 'n1', upstream: {}, downstream: [] as Array<{ nodeId: string; type: string }> }

describe('scheduleTriggerExecutor', () => {
  it('validates interval config', () => {
    expect(() => scheduleTriggerExecutor.validateConfig({ everyValue: 5, everyUnit: 'minute' })).not.toThrow()
  })
  it('validates cron config', () => {
    expect(() => scheduleTriggerExecutor.validateConfig({ everyValue: 1, everyUnit: 'hour', cron: '*/5 * * * *' })).not.toThrow()
  })
  it('rejects a non-positive interval', () => {
    expect(() => scheduleTriggerExecutor.validateConfig({ everyValue: 0, everyUnit: 'minute' })).toThrow()
  })
  it('fallback run emits a schedule payload', async () => {
    const out = await scheduleTriggerExecutor.run({ ...base, config: { everyValue: 1, everyUnit: 'minute' } }, ctx) as { kind: string; event: string }
    expect(out.kind).toBe('trigger')
    expect(out.event).toBe('schedule')
  })
})

describe('fileWatchTriggerExecutor', () => {
  it('validates folder config with events', () => {
    expect(() => fileWatchTriggerExecutor.validateConfig({ path: '/tmp', watchKind: 'folder', events: ['add', 'change'] })).not.toThrow()
  })
  it('requires at least one event', () => {
    expect(() => fileWatchTriggerExecutor.validateConfig({ path: '/tmp', watchKind: 'folder', events: [] })).toThrow()
  })
  it('fallback run throws (no file context in a manual run)', async () => {
    await expect(
      fileWatchTriggerExecutor.run({ ...base, config: { path: '/tmp', watchKind: 'folder', events: ['add'] } }, ctx),
    ).rejects.toThrow(/armed/i)
  })
})
