import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/api', () => ({
  exportProjectSnapshot: vi.fn(),
  importProjectSnapshot: vi.fn(),
}))

import { exportProjectSnapshot, importProjectSnapshot } from '@/api'
import { SnapshotIoButtons } from '@/components/snapshot-io-buttons'

const mockExport = vi.mocked(exportProjectSnapshot)
const mockImport = vi.mocked(importProjectSnapshot)

const SNAPSHOT = {
  kind: 'anubis-project-snapshot',
  schemaVersion: 1,
  competitors: [{}, {}],
  capturedPosts: [{}, {}, {}],
}

beforeEach(() => {
  mockExport.mockReset()
  mockImport.mockReset()
  // jsdom doesn't implement object URLs; stub them for the download path.
  ;(URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:mock')
  ;(URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function fileInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[type=file]') as HTMLInputElement
}

describe('<SnapshotIoButtons>', () => {
  it('exports the snapshot as a download and reports success', async () => {
    mockExport.mockResolvedValue(SNAPSHOT as never)
    const onResult = vi.fn()
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    render(<SnapshotIoButtons projectId='p1' projectName='My Project' onResult={onResult} />)
    fireEvent.click(screen.getByText('Export'))

    await waitFor(() => expect(onResult).toHaveBeenCalled())
    expect(mockExport).toHaveBeenCalledWith('p1')
    expect(clickSpy).toHaveBeenCalled() // a download was triggered
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }))
  })

  it('imports a valid snapshot file, refreshes, and reports success', async () => {
    mockImport.mockResolvedValue({
      ok: true,
      projectId: 'p1',
      competitors: { created: 1, matched: 0 },
      posts: { imported: 3, skipped: 0 },
      warnings: [],
    } as never)
    const onImported = vi.fn()
    const onResult = vi.fn()

    const { container } = render(
      <SnapshotIoButtons projectId='p1' onImported={onImported} onResult={onResult} />,
    )
    const file = new File([JSON.stringify(SNAPSHOT)], 'snap.json', { type: 'application/json' })
    fireEvent.change(fileInput(container), { target: { files: [file] } })

    await waitFor(() => expect(onResult).toHaveBeenCalled())
    expect(mockImport).toHaveBeenCalledWith({
      projectId: 'p1',
      snapshot: expect.objectContaining({ kind: 'anubis-project-snapshot' }),
    })
    expect(onImported).toHaveBeenCalled()
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }))
  })

  it('rejects a non-snapshot file without calling the import API', async () => {
    const onResult = vi.fn()
    const { container } = render(<SnapshotIoButtons onResult={onResult} />)
    const file = new File([JSON.stringify({ foo: 'bar' })], 'x.json', { type: 'application/json' })
    fireEvent.change(fileInput(container), { target: { files: [file] } })

    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' })),
    )
    expect(mockImport).not.toHaveBeenCalled()
  })
})
