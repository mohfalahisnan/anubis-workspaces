import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ProfileSummary } from '@anubis/shared'
import { useDefaultProfile, STORAGE_KEY } from '@/lib/use-default-profile'

function p(id: string, lastUsedAt?: number): ProfileSummary {
  return {
    id,
    name: id,
    source: 'builtin',
    config: { agent: 'claude' },
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
    ...(lastUsedAt !== undefined ? { lastUsedAt } : {}),
  } as ProfileSummary
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('useDefaultProfile', () => {
  it('returns null when the list is empty', () => {
    const { result } = renderHook(() => useDefaultProfile([]))
    expect(result.current[0]).toBeNull()
  })

  it('returns the localStorage id when it exists in the list', () => {
    window.localStorage.setItem(STORAGE_KEY, 'b')
    const { result } = renderHook(() => useDefaultProfile([p('a'), p('b'), p('c')]))
    expect(result.current[0]?.id).toBe('b')
  })

  it('falls back to most-recently-used when storage is empty', () => {
    const { result } = renderHook(() =>
      useDefaultProfile([p('a', 100), p('b', 500), p('c', 300)]),
    )
    expect(result.current[0]?.id).toBe('b')
  })

  it('falls back to first item when nobody has been used', () => {
    const { result } = renderHook(() => useDefaultProfile([p('a'), p('b')]))
    expect(result.current[0]?.id).toBe('a')
  })

  it('falls back when the stored id no longer exists', () => {
    window.localStorage.setItem(STORAGE_KEY, 'stale')
    const { result } = renderHook(() => useDefaultProfile([p('a'), p('b', 999)]))
    expect(result.current[0]?.id).toBe('b')
  })

  it('setter writes through to localStorage', () => {
    const { result } = renderHook(() => useDefaultProfile([p('a'), p('b')]))
    act(() => result.current[1](p('b')))
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('b')
    expect(result.current[0]?.id).toBe('b')
  })
})
