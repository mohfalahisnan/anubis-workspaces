/// <reference types="vite/client" />

type Unsubscribe = () => void

interface DownloadProgressInfo {
  percent?: number
  transferred?: number
  total?: number
  bytesPerSecond?: number
}

interface Window {
  anubis?: {
    backend: {
      getBaseUrl(): Promise<string>
    }
    updater: {
      check(): Promise<unknown>
      startDownload(): Promise<void>
      cancelDownload(): Promise<void>
      quitAndInstall(): Promise<void>
      onUpdateAvailable(listener: (payload: VersionInfo) => void): Unsubscribe
      onUpdateError(listener: (payload: ErrorType) => void): Unsubscribe
      onDownloadProgress(listener: (payload: DownloadProgressInfo) => void): Unsubscribe
      onUpdateDownloaded(listener: () => void): Unsubscribe
    }
  }
}
