import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePromptCardExpanded, STORAGE_KEY } from '@/lib/use-prompt-card-expanded'

beforeEach(() => {
  window.localStorage.clear()
})

describe('usePromptCardExpanded', () => {
  it('defaults to false when nothing is stored', () => {
    const { result } = renderHook(() => usePromptCardExpanded())
    expect(result.current[0]).toBe(false)
  })

  it('reads a stored true value', () => {
    window.localStorage.setItem(STORAGE_KEY, 'true')
    const { result } = renderHook(() => usePromptCardExpanded())
    expect(result.current[0]).toBe(true)
  })

  it('setter writes through to localStorage and updates state', () => {
    const { result } = renderHook(() => usePromptCardExpanded())
    act(() => result.current[1](true))
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('true')
    expect(result.current[0]).toBe(true)
  })
})
