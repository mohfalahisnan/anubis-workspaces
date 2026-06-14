import { describe, it, expect } from 'vitest'
import { selectAppProcesses, type ProcInfo } from '../apps/desktop/electron/main/process-cleanup'

const INSTALL = 'C:\\Users\\User\\AppData\\Local\\Programs\\Anubis'

function proc(p: Partial<ProcInfo> & { pid: number }): ProcInfo {
  return { name: '', exePath: '', commandLine: '', ...p }
}

describe('selectAppProcesses', () => {
  it('selects app binaries under the install dir, excluding self', () => {
    const procs = [
      proc({ pid: 100, name: 'Anubis.exe', exePath: INSTALL + '\\Anubis.exe' }), // main (self)
      proc({ pid: 101, name: 'Anubis.exe', exePath: INSTALL + '\\Anubis.exe' }), // backend child
    ]
    expect(selectAppProcesses(procs, { installDir: INSTALL, selfPid: 100, platform: 'win32' }))
      .toEqual([101])
  })

  it('selects crawler Chrome by --user-data-dir signature, any data root', () => {
    const dev = proc({
      pid: 200, name: 'chrome.exe',
      commandLine: 'chrome.exe --user-data-dir="C:\\Users\\User\\AppData\\Roaming\\Electron\\anubis\\chrome-profiles\\chrome-profile-public" --headless',
    })
    const packaged = proc({
      pid: 201, name: 'chrome.exe',
      commandLine: 'chrome.exe --user-data-dir=C:\\Users\\User\\AppData\\Roaming\\Anubis\\anubis\\chrome-profiles\\chrome-profile-login',
    })
    expect(selectAppProcesses([dev, packaged], { installDir: INSTALL, selfPid: 1, platform: 'win32' }).sort())
      .toEqual([200, 201])
  })

  it('does NOT select the user personal Chrome', () => {
    const renderer = proc({ pid: 300, name: 'chrome.exe', commandLine: 'chrome.exe --type=renderer' })
    const personal = proc({
      pid: 301, name: 'chrome.exe',
      commandLine: 'chrome.exe --user-data-dir="C:\\Users\\User\\AppData\\Local\\Google\\Chrome\\User Data"',
    })
    expect(selectAppProcesses([renderer, personal], { installDir: INSTALL, selfPid: 1, platform: 'win32' }))
      .toEqual([])
  })

  it('does NOT select unrelated node.exe or Anubis.exe outside the install dir', () => {
    const node = proc({ pid: 400, name: 'node.exe', exePath: 'C:\\Program Files\\nodejs\\node.exe', commandLine: 'node server.js' })
    const otherAnubis = proc({ pid: 401, name: 'Anubis.exe', exePath: 'D:\\dev\\other\\Anubis.exe' })
    expect(selectAppProcesses([node, otherAnubis], { installDir: INSTALL, selfPid: 1, platform: 'win32' }))
      .toEqual([])
  })

  it('does NOT select the current app process tree (own GPU / network-service / renderer helpers)', () => {
    // Electron runs its GPU, utility (network service) and renderer children
    // from the SAME Anubis.exe under the install dir. They are descendants of
    // the main process and Electron tears them down on quit — the sweep must
    // not force-kill them, or every quit logs "GPU process exited" / "Network
    // service crashed". Escaped/orphaned same-exe binaries (no ancestry to
    // self) are still fair game.
    const procs = [
      proc({ pid: 100, name: 'Anubis.exe', exePath: INSTALL + '\\Anubis.exe' }), // main (self)
      proc({ pid: 110, name: 'Anubis.exe', exePath: INSTALL + '\\Anubis.exe', parentPid: 100 }), // gpu
      proc({ pid: 111, name: 'Anubis.exe', exePath: INSTALL + '\\Anubis.exe', parentPid: 100 }), // network service
      proc({ pid: 112, name: 'Anubis.exe', exePath: INSTALL + '\\Anubis.exe', parentPid: 110 }), // grandchild
      proc({ pid: 999, name: 'Anubis.exe', exePath: INSTALL + '\\Anubis.exe', parentPid: 1 }), // orphan from a prior run
    ]
    expect(selectAppProcesses(procs, { installDir: INSTALL, selfPid: 100, platform: 'win32' }))
      .toEqual([999])
  })

  it('matches case-insensitively on win32 and handles trailing slash on install dir', () => {
    const p = proc({ pid: 500, name: 'anubis.exe', exePath: 'c:\\users\\user\\appdata\\local\\programs\\anubis\\Anubis.exe' })
    expect(selectAppProcesses([p], { installDir: INSTALL + '\\', selfPid: 1, platform: 'win32' }))
      .toEqual([500])
  })
})
