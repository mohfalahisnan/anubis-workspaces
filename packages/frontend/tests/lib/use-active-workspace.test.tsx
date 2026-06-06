import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('@/api', () => ({
  listBrandWorkspaces: vi.fn(),
  createBrandWorkspace: vi.fn(),
  updateBrandWorkspace: vi.fn(),
}))

import { listBrandWorkspaces } from '@/api'
import { WorkspaceProvider, useActiveWorkspace } from '@/lib/workspace'

function Probe() {
  const { activeWorkspace, workspaces } = useActiveWorkspace()
  return <div data-testid="active">{activeWorkspace?.name ?? '—'}:{workspaces.length}</div>
}

beforeEach(() => {
  window.localStorage.clear()
  vi.mocked(listBrandWorkspaces).mockResolvedValue([
    { id: 'default-workspace', name: 'Default', brandSummary: null, status: 'active', createdAt: 1, updatedAt: 1 },
    { id: 'ws-b', name: 'Brand B', brandSummary: null, status: 'active', createdAt: 2, updatedAt: 2 },
  ])
})

describe('useActiveWorkspace', () => {
  it('defaults to default-workspace and loads the list', async () => {
    render(<WorkspaceProvider><Probe /></WorkspaceProvider>)
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe('Default:2'))
  })

  it('falls back to default when the persisted id is absent from the list', async () => {
    window.localStorage.setItem('anubis.activeWorkspaceId', 'ghost')
    render(<WorkspaceProvider><Probe /></WorkspaceProvider>)
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe('Default:2'))
  })
})
