import { createBrowserManager, type BrowserManager, type ConnectFn } from './browser-manager.js'
import { launchChrome, killChrome, type LaunchChromeInput, type LaunchChromeResult } from '../chrome/launch-chrome.js'

export type LaunchBrowserManagerOptions = LaunchChromeInput & {
  fetchImpl?: typeof fetch
  connect?: ConnectFn
  maxConcurrentTabs?: number
  commandTimeoutMs?: number
  /** Injectable for tests. */
  launchChromeImpl?: (input: LaunchChromeInput) => Promise<LaunchChromeResult>
}

/** Reuse-or-spawn Chrome via launchChrome, then attach a BrowserManager at its origin. */
export async function launchBrowserManager(options: LaunchBrowserManagerOptions): Promise<BrowserManager> {
  const launch = options.launchChromeImpl ?? launchChrome
  const { fetchImpl, connect, maxConcurrentTabs, commandTimeoutMs, launchChromeImpl, ...launchInput } = options
  const result = await launch(launchInput)
  const chromeOrigin = `http://127.0.0.1:${result.remoteDebuggingPort}`
  return createBrowserManager({
    chromeOrigin,
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(connect ? { connect } : {}),
    ...(maxConcurrentTabs !== undefined ? { maxConcurrentTabs } : {}),
    ...(commandTimeoutMs !== undefined ? { commandTimeoutMs } : {}),
  })
}

export type CloseBrowserManagerOptions = {
  kill?: boolean
  /** Required when kill is true: the port whose Chrome to kill. */
  port?: number
  /** Injectable for tests. */
  killChromeImpl?: (port: number) => Promise<void>
}

/** Close the manager's socket (and its tabs); optionally kill the Chrome process. */
export async function closeBrowserManager(manager: BrowserManager, options: CloseBrowserManagerOptions = {}): Promise<void> {
  await manager.close()
  if (options.kill && typeof options.port === 'number') {
    const kill = options.killChromeImpl ?? killChrome
    await kill(options.port)
  }
}
