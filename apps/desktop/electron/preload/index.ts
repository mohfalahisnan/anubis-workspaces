import { contextBridge, ipcRenderer } from 'electron'

type Listener<T> = (payload: T) => void

function subscribe<T>(channel: string, listener: Listener<T>) {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload)

  ipcRenderer.on(channel, handler)

  return () => {
    ipcRenderer.off(channel, handler)
  }
}

contextBridge.exposeInMainWorld('anubis', {
  backend: {
    getBaseUrl: () => ipcRenderer.invoke('anubis:get-backend-url') as Promise<string>,
  },
  openExtensionFolder: (folderPath: string) =>
    ipcRenderer.invoke('anubis:open-extension-folder', folderPath) as Promise<string>,
  updater: {
    check: () => ipcRenderer.invoke('check-update'),
    startDownload: () => ipcRenderer.invoke('start-download'),
    cancelDownload: () => ipcRenderer.invoke('cancel-download'),
    quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),
    onUpdateAvailable: <T>(listener: Listener<T>) => subscribe('update-can-available', listener),
    onUpdateError: <T>(listener: Listener<T>) => subscribe('update-error', listener),
    onDownloadProgress: <T>(listener: Listener<T>) => subscribe('download-progress', listener),
    onUpdateDownloaded: (listener: Listener<void>) => subscribe('update-downloaded', listener),
  },
})

function domReady(condition: DocumentReadyState[] = ['complete', 'interactive']) {
  return new Promise(resolve => {
    if (condition.includes(document.readyState)) {
      resolve(true)
    } else {
      document.addEventListener('readystatechange', () => {
        if (condition.includes(document.readyState)) {
          resolve(true)
        }
      })
    }
  })
}

const safeDOM = {
  append(parent: HTMLElement, child: HTMLElement) {
    if (!Array.from(parent.children).find(e => e === child)) {
      return parent.appendChild(child)
    }
  },
  remove(parent: HTMLElement, child: HTMLElement) {
    if (Array.from(parent.children).find(e => e === child)) {
      return parent.removeChild(child)
    }
  },
}

function useLoading() {
  const className = `loaders-css__square-spin`
  const styleContent = `
@keyframes square-spin {
  25% { transform: perspective(100px) rotateX(180deg) rotateY(0); }
  50% { transform: perspective(100px) rotateX(180deg) rotateY(180deg); }
  75% { transform: perspective(100px) rotateX(0) rotateY(180deg); }
  100% { transform: perspective(100px) rotateX(0) rotateY(0); }
}
.${className} > div {
  animation-fill-mode: both;
  width: 50px;
  height: 50px;
  background: #fff;
  animation: square-spin 3s 0s cubic-bezier(0.09, 0.57, 0.49, 0.9) infinite;
}
.app-loading-wrap {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #282c34;
  z-index: 9;
}
    `
  const oStyle = document.createElement('style')
  const oDiv = document.createElement('div')

  oStyle.id = 'app-loading-style'
  oStyle.innerHTML = styleContent
  oDiv.className = 'app-loading-wrap'
  oDiv.innerHTML = `<div class="${className}"><div></div></div>`

  return {
    appendLoading() {
      safeDOM.append(document.head, oStyle)
      safeDOM.append(document.body, oDiv)
    },
    removeLoading() {
      safeDOM.remove(document.head, oStyle)
      safeDOM.remove(document.body, oDiv)
    },
  }
}

const { appendLoading, removeLoading } = useLoading()
domReady().then(appendLoading)

window.onmessage = (ev) => {
  ev.data.payload === 'removeLoading' && removeLoading()
}

setTimeout(removeLoading, 4999)
