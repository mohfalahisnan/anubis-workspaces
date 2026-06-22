import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { buildKnowledgeTree, KnowledgeFileTree } from '@/components/knowledge/file-tree'

const entries = [
  { path: 'root.md', size: 10, updatedAt: '2026-06-22T00:00:00Z' },
  { path: 'brand/voice.md', size: 20, updatedAt: '2026-06-22T00:00:00Z' },
  { path: 'brand/offer.md', size: 30, updatedAt: '2026-06-22T00:00:00Z' },
]

describe('buildKnowledgeTree', () => {
  it('nests files under folders, folders before files, each sorted', () => {
    const tree = buildKnowledgeTree(entries)
    expect(tree[0].kind).toBe('folder')
    expect(tree[0].name).toBe('brand')
    if (tree[0].kind === 'folder') {
      expect(tree[0].children.map((c) => c.name)).toEqual(['offer.md', 'voice.md'])
    }
    expect(tree[1].kind).toBe('file')
    expect(tree[1].name).toBe('root.md')
  })
})

describe('KnowledgeFileTree', () => {
  it('calls onSelect with the path when a file is clicked', () => {
    const onSelect = vi.fn()
    render(<KnowledgeFileTree entries={entries} selectedPath={null} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('root.md'))
    expect(onSelect).toHaveBeenCalledWith('root.md')
  })

  it('shows an empty message when there are no files', () => {
    render(<KnowledgeFileTree entries={[]} selectedPath={null} onSelect={() => {}} />)
    expect(screen.getByText('No files yet.')).toBeInTheDocument()
  })
})
