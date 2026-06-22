import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MarkdownEditor } from '@/components/knowledge/markdown-editor'

describe('MarkdownEditor', () => {
  it('calls onChange with the new value when typed', () => {
    const onChange = vi.fn()
    render(<MarkdownEditor value='hi' onChange={onChange} />)
    fireEvent.change(screen.getByDisplayValue('hi'), { target: { value: 'hello world' } })
    expect(onChange).toHaveBeenCalledWith('hello world')
  })
})
