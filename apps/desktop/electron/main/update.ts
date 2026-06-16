import { app, ipcMain } from 'electron'
import type {
  ProgressInfo,
  UpdateDownloadedEvent,
  UpdateInfo,
} from 'electron-updater'
// Pure cjs module does not support named exports, so we need to import the default export and access the autoUpdater property
import updater from 'electron-updater'
import path from 'node:path'
import { sweepAppProcesses } from './process-cleanup'

const autoUpdater = updater.autoUpdater
let cancellationToken = new updater.CancellationToken()
let isDownloading = false

export function update(win: Electron.BrowserWindow) {

  // When set to false, the update download will be triggered through the API
  autoUpdater.autoDownload = false
  autoUpdater.disableWebInstaller = false
  autoUpdater.allowDowngrade = false

  // start check
  autoUpdater.on('checking-for-update', function () { })
  // update available
  autoUpdater.on('update-available', (arg: UpdateInfo) => {
    win.webContents.send('update-can-available', { update: true, version: app.getVersion(), newVersion: arg?.version })
  })
  // update not available
  autoUpdater.on('update-not-available', (arg: UpdateInfo) => {
    win.webContents.send('update-can-available', { update: false, version: app.getVersion(), newVersion: arg?.version })
  })

  // Checking for updates
  ipcMain.handle('check-update', async () => {
    if (!app.isPackaged) {
      const error = new Error('The update feature is only available after the package.')
      return { message: error.message, error }
    }

    try {
      return await autoUpdater.checkForUpdates()
    } catch (error) {
      const resolvedError = error instanceof Error ? error : new Error('Network error')
      return { message: resolvedError.message, error: resolvedError }
    }
  })

  // Start downloading and feedback on progress
  ipcMain.handle('start-download', (event: Electron.IpcMainInvokeEvent) => {
    if (isDownloading) return

    isDownloading = true
    startDownload(
      (error, progressInfo) => {
        if (error) {
          isDownloading = false
          // feedback download error message
          event.sender.send('update-error', { message: error.message, error })
        } else {
          // feedback update progress message
          event.sender.send('download-progress', progressInfo)
        }
      },
      () => {
        isDownloading = false
        // feedback update downloaded message
        event.sender.send('update-downloaded')
      }
    )
  })

  // Cancel downloading
  ipcMain.handle('cancel-download', () => {
    cancellationToken.cancel()
    cancellationToken = new updater.CancellationToken();
  })

  // Install now.
  // NOTE: On macOS, electron-updater requires the app to be code-signed and notarized
  // (Apple Developer ID + notarization). Until that is set up, this call will fail
  // silently on Mac. Windows works fine without signing (just shows SmartScreen warnings).
  ipcMain.handle('quit-and-install', async () => {
    // Kill the backend Anubis.exe + crawler Chrome now, so NSIS never races a
    // surviving child holding install-dir DLLs. quitAndInstall also fires
    // before-quit, but doing it here guarantees completion before handoff.
    //
    // spareSelfTree:false is load-bearing: the backend is a direct CHILD of
    // this main process, so the default self-tree sparing would protect it and
    // leave it locking better-sqlite3.node / node-pty under the install dir —
    // exactly what makes NSIS report "Anubis cannot be closed". Here we are
    // about to quit anyway, so killing our own helpers is fine.
    sweepAppProcesses({
      installDir: path.dirname(process.execPath),
      selfPid: process.pid,
      spareSelfTree: false,
    })
    // taskkill returns once the signal is delivered, but Windows does not
    // release a mapped .node image instantly. Give it a moment so the handles
    // are gone before the NSIS installer starts overwriting install-dir files
    // (mirrors the Sleep 500 in build/installer.nsh).
    await new Promise((resolve) => setTimeout(resolve, 500))
    autoUpdater.quitAndInstall(false, true)
  })
}

function startDownload(
  callback: (error: Error | null, info: ProgressInfo | null) => void,
  complete: (event: UpdateDownloadedEvent) => void,
) {
  const onDownloadProgress = (info: ProgressInfo) => callback(null, info)
  const onError = (error: Error) => {
    cleanup()
    callback(error, null)
  }
  const onDownloaded = (event: UpdateDownloadedEvent) => {
    cleanup()
    complete(event)
  }

  const cleanup = () => {
    autoUpdater.off('download-progress', onDownloadProgress)
    autoUpdater.off('error', onError)
    autoUpdater.off('update-downloaded', onDownloaded)
  }

  autoUpdater.on('download-progress', onDownloadProgress)
  autoUpdater.on('error', onError)
  autoUpdater.once('update-downloaded', onDownloaded)
  autoUpdater.downloadUpdate(cancellationToken)
}
