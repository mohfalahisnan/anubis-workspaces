import { describe, it, expect } from 'vitest'
import { detectCronCommands } from '../../src/conversations/cron-detect.js'

describe('detectCronCommands', () => {
  it('parses CRON_CREATE blocks', () => {
    const text = `Some prose\n[CRON_CREATE]\nname: Backup\nschedule: 0 0 * * *\nschedule_description: midnight\nmessage: run backup\n[/CRON_CREATE]\nmore prose`
    const cmds = detectCronCommands(text)
    expect(cmds).toEqual([{
      kind: 'create',
      params: {
        name: 'Backup',
        schedule: '0 0 * * *',
        scheduleDescription: 'midnight',
        message: 'run backup',
      },
    }])
  })

  it('parses CRON_DELETE with id', () => {
    const cmds = detectCronCommands('[CRON_DELETE: abc-123]')
    expect(cmds).toEqual([{ kind: 'delete', id: 'abc-123' }])
  })

  it('parses CRON_LIST', () => {
    expect(detectCronCommands('[CRON_LIST]')).toEqual([{ kind: 'list' }])
  })

  it('parses CRON_UPDATE blocks with optional fields', () => {
    const text = `[CRON_UPDATE: id1]\nname: New\nschedule: 0 12 * * *\n[/CRON_UPDATE]`
    expect(detectCronCommands(text)).toEqual([{
      kind: 'update',
      id: 'id1',
      params: { name: 'New', schedule: '0 12 * * *' },
    }])
  })

  it('returns empty for text without commands', () => {
    expect(detectCronCommands('hello world')).toEqual([])
  })

  it('extracts multiple commands in one message', () => {
    const text = `[CRON_LIST]\n[CRON_DELETE: x]`
    expect(detectCronCommands(text)).toHaveLength(2)
  })
})
