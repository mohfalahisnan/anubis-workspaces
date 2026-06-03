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
    shell: {
      /** Resolves to '' on success or an error message string. */
      openPath(target: string): Promise<string>
    }
    skills: {
      /** Resolves to the selected absolute path, or null if cancelled. */
      pickSource(kind: 'folder' | 'zip'): Promise<string | null>
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
