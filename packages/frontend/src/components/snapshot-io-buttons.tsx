import { useRef, useState } from 'react'
import { DownloadCloudIcon, UploadCloudIcon } from 'lucide-react'
import { exportProjectSnapshot, importProjectSnapshot } from '@/api'

/**
 * Export / Import buttons for the whole-project snapshot (all competitors +
 * captured posts) used on the Competitors, Content, and Capture pages.
 *
 * Renders a fragment of two buttons + a hidden file input so it slots straight
 * into an existing toolbar flex row. Export downloads a JSON file; Import reads
 * a snapshot file and merges it into the active project. The component owns its
 * own busy state; the host page surfaces results via `onResult` and refreshes
 * its data via `onImported`.
 */

const BUTTON_CLASS =
  'inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3.5 text-[13.5px] font-medium text-foreground transition-colors hover:border-[color-mix(in_oklab,var(--anubis-gold)_45%,var(--border))] hover:bg-muted disabled:opacity-50'

export interface SnapshotIoResult {
  kind: 'success' | 'error'
  message: string
}

export interface SnapshotIoButtonsProps {
  /** Active project id; undefined targets the backend default project. */
  projectId?: string
  /** Project name, used to slugify the export filename. */
  projectName?: string
  /** Called after a successful import so the host page can refresh its data. */
  onImported?: () => void | Promise<void>
  /** Surface a success/error message via the host page's banner or toast. */
  onResult?: (result: SnapshotIoResult) => void
  /** Extra disable condition from the host page (e.g. select mode). */
  disabled?: boolean
}

export function SnapshotIoButtons({
  projectId,
  projectName,
  onImported,
  onResult,
  disabled,
}: SnapshotIoButtonsProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleExport(): Promise<void> {
    setBusy(true)
    try {
      const snapshot = await exportProjectSnapshot(projectId)
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const slug = (projectName || 'project')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      const a = document.createElement('a')
      a.href = url
      a.download = `anubis-${slug || 'project'}-${date}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      onResult?.({
        kind: 'success',
        message: `Exported ${snapshot.competitors.length} competitor(s) and ${snapshot.capturedPosts.length} post(s).`,
      })
    } catch (e) {
      onResult?.({ kind: 'error', message: e instanceof Error ? e.message : 'Export failed.' })
    } finally {
      setBusy(false)
    }
  }

  async function handleImportFile(file: File): Promise<void> {
    setBusy(true)
    try {
      const text = await file.text()
      const snapshot = JSON.parse(text)
      if (!snapshot || snapshot.kind !== 'anubis-project-snapshot') {
        throw new Error('Not an Anubis project snapshot file.')
      }
      const result = await importProjectSnapshot({ projectId, snapshot })
      await onImported?.()
      const parts = [
        `${result.competitors.created} new competitor(s), ${result.competitors.matched} matched`,
        `${result.posts.imported} post(s) imported, ${result.posts.skipped} skipped`,
      ]
      if (result.warnings.length) parts.push(result.warnings.join(' '))
      onResult?.({ kind: 'success', message: `Import complete — ${parts.join('; ')}.` })
    } catch (e) {
      onResult?.({ kind: 'error', message: e instanceof Error ? e.message : 'Import failed.' })
    } finally {
      setBusy(false)
    }
  }

  const isDisabled = busy || disabled

  return (
    <>
      <button type='button' onClick={() => void handleExport()} disabled={isDisabled} className={BUTTON_CLASS}>
        <DownloadCloudIcon className='size-[15px]' strokeWidth={2} />
        Export
      </button>
      <button
        type='button'
        onClick={() => inputRef.current?.click()}
        disabled={isDisabled}
        className={BUTTON_CLASS}
      >
        <UploadCloudIcon className='size-[15px]' strokeWidth={2} />
        Import
      </button>
      <input
        ref={inputRef}
        type='file'
        accept='application/json,.json'
        className='hidden'
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = '' // allow re-importing the same file
          if (file) void handleImportFile(file)
        }}
      />
    </>
  )
}
