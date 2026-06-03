import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { startBackend } from './backend'
import { update } from './update'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const APP_ROOT = path.join(__dirname, '../../../..')
process.env.APP_ROOT = APP_ROOT

export const MAIN_DIST = path.join(APP_ROOT, 'apps/desktop/dist-electron')
export const RENDERER_DIST = path.join(APP_ROOT, 'packages/frontend/dist')
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(APP_ROOT, 'packages/frontend/public')
  : RENDERER_DIST

if (process.platform === 'win32' && os.release().startsWith('6.1')) app.disableHardwareAcceleration()
if (process.platform === 'win32') app.setAppUserModelId(app.getName())

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let win: BrowserWindow | null = null
let backendUrl = ''
let stopBackend: (() => void) | undefined

const preload = path.join(__dirname, '../preload/index.mjs')
const indexHtml = path.join(RENDERER_DIST, 'index.html')

ipcMain.handle('anubis:get-backend-url', () => backendUrl)

// Open a folder or file in the OS file manager. shell.openPath returns
// '' on success and a string error message otherwise — we forward both
// so the renderer can react. Reject anything that isn't an absolute path
// or any path that resolves outside what already exists on disk; this is
// only ever called with paths the backend already manages, but defence
// in depth is cheap.
ipcMain.handle('anubis:open-path', async (_event, target: string) => {
  if (typeof target !== 'string' || target.trim() === '') {
    return 'invalid path'
  }
  return await shell.openPath(target)
})

// Native picker for importing a skill: a folder containing SKILL.md or a
// .zip archive. Returns the selected absolute path, or null on cancel.
ipcMain.handle('anubis:pick-skill-source', async (_event, kind: 'folder' | 'zip') => {
  const options: Electron.OpenDialogOptions = {
    title: kind === 'zip' ? 'Select skill .zip' : 'Select skill folder',
    properties: kind === 'zip' ? ['openFile'] : ['openDirectory'],
    filters: kind === 'zip' ? [{ name: 'Zip archive', extensions: ['zip'] }] : undefined,
  }
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

async function createWindow() {
  win = new BrowserWindow({
    title: 'Anubis',
    icon: path.join(process.env.VITE_PUBLIC, 'favicon.ico'),
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
    win.webContents.openDevTools()
  } else {
    win.loadFile(indexHtml)
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url)
    return { action: 'deny' }
  })

  update(win)
}

app.whenReady().then(async () => {
  const backendRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked')
    : APP_ROOT
  const dataDir = path.join(app.getPath('userData'), 'anubis')
  const backend = await startBackend(backendRoot, Boolean(VITE_DEV_SERVER_URL), dataDir)
  backendUrl = backend.url
  stopBackend = backend.stop

  await createWindow()
}).catch((error) => {
  console.error(error)
  app.quit()
})

app.on('before-quit', () => {
  stopBackend?.()
})

app.on('window-all-closed', () => {
  win = null
  if (process.platform !== 'darwin') app.quit()
})

app.on('second-instance', () => {
  if (!win) return

  if (win.isMinimized()) win.restore()
  win.focus()
})

app.on('activate', () => {
  const allWindows = BrowserWindow.getAllWindows()
  if (allWindows.length) {
    allWindows[0].focus()
  } else {
    createWindow()
  }
})
