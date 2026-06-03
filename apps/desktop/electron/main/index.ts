import { app, BrowserWindow, ipcMain, shell } from 'electron'
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

ipcMain.handle('anubis:open-extension-folder', (_e, folderPath: string) => {
  return shell.openPath(folderPath)
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
