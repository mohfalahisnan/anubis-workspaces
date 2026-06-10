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

  it('parses competitor-discovery cron jobs with config_json', () => {
    const text = `[CRON_CREATE]\nname: Discover creators\nschedule: 0 9 * * 1\naction_type: competitor-discovery\nconfig_json: {"projectId":"p1","query":"#spacephotography","captureProfile":"login","defaultLevel":"green"}\n[/CRON_CREATE]`
    expect(detectCronCommands(text)).toEqual([{
      kind: 'create',
      params: {
        name: 'Discover creators',
        schedule: '0 9 * * 1',
        actionType: 'competitor-discovery',
        actionConfig: {
          projectId: 'p1',
          query: '#spacephotography',
          captureProfile: 'login',
          defaultLevel: 'green',
        },
      },
    }])
  })

  it('parses capture-posts cron updates with config_json', () => {
    const text = `[CRON_UPDATE: job-1]\naction_type: capture-posts\nconfig_json: {"projectId":"p1","handles":"all","captureProfile":"public","postLimit":12}\n[/CRON_UPDATE]`
    expect(detectCronCommands(text)).toEqual([{
      kind: 'update',
      id: 'job-1',
      params: {
        actionType: 'capture-posts',
        actionConfig: {
          projectId: 'p1',
          handles: 'all',
          captureProfile: 'public',
          postLimit: 12,
        },
      },
    }])
  })

  it('parses workflow cron jobs with config_json (by name + input)', () => {
    const text = `[CRON_CREATE]\nname: Nightly pipeline\nschedule: 0 2 * * *\naction_type: workflow\nconfig_json: {"workflowName":"Content pipeline","projectId":"p1","input":{"n1":{"value":"x"}}}\n[/CRON_CREATE]`
    expect(detectCronCommands(text)).toEqual([{
      kind: 'create',
      params: {
        name: 'Nightly pipeline',
        schedule: '0 2 * * *',
        actionType: 'workflow',
        actionConfig: {
          workflowName: 'Content pipeline',
          projectId: 'p1',
          input: { n1: { value: 'x' } },
        },
      },
    }])
  })

  it('parses workflow cron jobs by workflowId without input', () => {
    const text = `[CRON_CREATE]\nname: Run wf\nschedule: 0 3 * * *\naction_type: workflow\nconfig_json: {"workflowId":"wf-123"}\n[/CRON_CREATE]`
    expect(detectCronCommands(text)).toEqual([{
      kind: 'create',
      params: {
        name: 'Run wf',
        schedule: '0 3 * * *',
        actionType: 'workflow',
        actionConfig: { workflowId: 'wf-123' },
      },
    }])
  })

  it('rejects workflow config that names neither id nor name', () => {
    const text = `[CRON_CREATE]\nname: Bad wf\nschedule: 0 4 * * *\naction_type: workflow\nconfig_json: {"projectId":"p1"}\n[/CRON_CREATE]`
    // Invalid config for a non-message action -> command dropped.
    expect(detectCronCommands(text)).toEqual([])
  })

  it('returns empty for text without commands', () => {
    expect(detectCronCommands('hello world')).toEqual([])
  })

  it('extracts multiple commands in one message', () => {
    const text = `[CRON_LIST]\n[CRON_DELETE: x]`
    expect(detectCronCommands(text)).toHaveLength(2)
  })
})
