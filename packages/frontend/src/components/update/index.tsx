import { useCallback, useEffect, useState } from 'react'
import Modal from '@/components/update/modal'
import Progress from '@/components/update/progress'

// The component is mounted once at the App root (modal + IPC listeners).
// Other surfaces (Settings) trigger a manual check through this module-level
// hook instead of mounting a second instance with duplicate IPC listeners.
let activeCheck: (() => Promise<void>) | null = null

export function requestUpdateCheck() {
  void activeCheck?.()
}

export function isUpdaterAvailable() {
  return Boolean(window.anubis?.updater)
}

const Update = () => {
  const [checking, setChecking] = useState(false)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [versionInfo, setVersionInfo] = useState<VersionInfo>()
  const [updateError, setUpdateError] = useState<ErrorType>()
  const [progressInfo, setProgressInfo] = useState<DownloadProgressInfo>()
  const [modalOpen, setModalOpen] = useState<boolean>(false)
  const [modalBtn, setModalBtn] = useState<{
    cancelText?: string
    okText?: string
    onCancel?: () => void
    onOk?: () => void
  }>({
    onCancel: () => window.anubis?.updater.cancelDownload().then(() => setModalOpen(false)),
    onOk: () => window.anubis?.updater.startDownload(),
  })

  const checkUpdate = async () => {
    if (!window.anubis || checking) return

    setChecking(true)
    const result = await window.anubis.updater.check() as ErrorType | undefined
    setProgressInfo({ percent: 0 })
    setChecking(false)
    setModalOpen(true)
    if (result?.error) {
      setUpdateAvailable(false)
      setUpdateError(result)
    }
  }

  const onUpdateCanAvailable = useCallback(
    (payload: VersionInfo) => {
      setVersionInfo(payload)
      setUpdateError(undefined)
      // Can be update
      if (payload.update) {
        setModalBtn((state) => ({
          ...state,
          cancelText: 'Cancel',
          okText: 'Update',
          onOk: () => window.anubis?.updater.startDownload(),
        }))
        setUpdateAvailable(true)
        setModalOpen(true)
      } else {
        setUpdateAvailable(false)
      }
    },
    [],
  )

  const onUpdateError = useCallback((arg1: ErrorType) => {
    setUpdateAvailable(false)
    setUpdateError(arg1)
  }, [])

  const onDownloadProgress = useCallback(
    (arg1: DownloadProgressInfo) => {
      setProgressInfo(arg1)
    },
    [],
  )

  const onUpdateDownloaded = useCallback(() => {
    setProgressInfo({ percent: 100 })
    setModalBtn((state) => ({
      ...state,
      cancelText: 'Later',
      okText: 'Install now',
      onOk: () => window.anubis?.updater.quitAndInstall(),
    }))
  }, [])

  // Re-register every render so the manual trigger always sees fresh state.
  useEffect(() => {
    activeCheck = checkUpdate
    return () => { activeCheck = null }
  })

  useEffect(() => {
    if (!window.anubis) return

    const unsubscribeUpdateAvailable = window.anubis.updater.onUpdateAvailable(onUpdateCanAvailable)
    const unsubscribeUpdateError = window.anubis.updater.onUpdateError(onUpdateError)
    const unsubscribeDownloadProgress = window.anubis.updater.onDownloadProgress(onDownloadProgress)
    const unsubscribeUpdateDownloaded = window.anubis.updater.onUpdateDownloaded(onUpdateDownloaded)

    // Silent check on launch — the modal only opens if onUpdateCanAvailable reports update=true.
    window.anubis.updater.check().catch(() => { /* dev build / offline — ignore */ })

    return () => {
      unsubscribeUpdateAvailable()
      unsubscribeUpdateError()
      unsubscribeDownloadProgress()
      unsubscribeUpdateDownloaded()
    }
  }, [])

  return (
    <Modal
      open={modalOpen}
      cancelText={modalBtn?.cancelText}
      okText={modalBtn?.okText}
      onCancel={modalBtn?.onCancel}
      onOk={modalBtn?.onOk}
      title="Updater"
      footer={updateAvailable ? /* hide footer */ null : undefined}
    >
      <div className="space-y-3">
        {updateError ? (
          <div className="text-sm leading-6 text-rose-700">
            <p className="font-semibold text-rose-900">Error downloading the latest version.</p>
            <p className="mt-1 max-h-40 overflow-auto">{updateError.message}</p>
          </div>
        ) : updateAvailable ? (
          <div className="space-y-3 text-sm text-slate-700">
            <div className="text-base font-semibold text-slate-900">
              The latest version is v{versionInfo?.newVersion}
            </div>
            <div className="text-slate-600">
              v{versionInfo?.version} -&gt; v{versionInfo?.newVersion}
            </div>
            <div className="flex items-center gap-3 pt-1">
              <div className="shrink-0 font-medium text-slate-700">Update progress:</div>
              <div className="min-w-0 flex-1">
                <Progress percent={progressInfo?.percent}></Progress>
              </div>
            </div>
          </div>
        ) : (
          <pre className="overflow-auto text-left text-xs leading-6 text-slate-700">
            {JSON.stringify(versionInfo ?? {}, null, 2)}
          </pre>
        )}
      </div>
    </Modal>
  )
}

export default Update
