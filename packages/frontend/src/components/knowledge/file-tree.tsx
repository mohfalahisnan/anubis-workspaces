import { useMemo, useState } from 'react'
import { ChevronRightIcon, FileTextIcon, FolderIcon } from 'lucide-react'
import type { KnowledgeBaseFileEntry } from '@anubis/shared'
import { cn } from '@/lib/utils'

export interface KnowledgeTreeFile { kind: 'file'; name: string; path: string }
export interface KnowledgeTreeFolder { kind: 'folder'; name: string; path: string; children: KnowledgeTreeNode[] }
export type KnowledgeTreeNode = KnowledgeTreeFolder | KnowledgeTreeFile

export function buildKnowledgeTree(entries: { path: string }[]): KnowledgeTreeNode[] {
  const root: KnowledgeTreeFolder = { kind: 'folder', name: '', path: '', children: [] }
  for (const entry of entries) {
    const parts = entry.path.split('/')
    let cursor = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!
      const isFile = i === parts.length - 1
      if (isFile) {
        cursor.children.push({ kind: 'file', name: part, path: entry.path })
      } else {
        const folderPath = parts.slice(0, i + 1).join('/')
        let next = cursor.children.find(
          (c): c is KnowledgeTreeFolder => c.kind === 'folder' && c.path === folderPath,
        )
        if (!next) {
          next = { kind: 'folder', name: part, path: folderPath, children: [] }
          cursor.children.push(next)
        }
        cursor = next
      }
    }
  }
  sortTree(root.children)
  return root.children
}

function sortTree(nodes: KnowledgeTreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  for (const n of nodes) if (n.kind === 'folder') sortTree(n.children)
}

export function KnowledgeFileTree({
  entries, selectedPath, onSelect,
}: {
  entries: KnowledgeBaseFileEntry[]
  selectedPath: string | null
  onSelect: (path: string) => void
}) {
  const tree = useMemo(() => buildKnowledgeTree(entries), [entries])
  if (entries.length === 0) {
    return <p className='px-3 py-1.5 text-[12px] text-muted-foreground'>No files yet.</p>
  }
  return (
    <ul className='flex flex-col'>
      {tree.map((node) => (
        <TreeNode key={node.path} node={node} depth={0} selectedPath={selectedPath} onSelect={onSelect} />
      ))}
    </ul>
  )
}

function TreeNode({
  node, depth, selectedPath, onSelect,
}: {
  node: KnowledgeTreeNode
  depth: number
  selectedPath: string | null
  onSelect: (path: string) => void
}) {
  const [open, setOpen] = useState(true)
  const pad = depth * 12 + 8
  if (node.kind === 'folder') {
    return (
      <li>
        <button
          type='button'
          onClick={() => setOpen((v) => !v)}
          style={{ paddingLeft: pad }}
          className='flex w-full items-center gap-1 rounded px-2 py-1 text-left text-[12.5px] text-foreground/80 hover:bg-background'
        >
          <ChevronRightIcon className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
          <FolderIcon className='size-3.5 shrink-0 text-muted-foreground' />
          <span className='truncate'>{node.name}</span>
        </button>
        {open && (
          <ul>
            {node.children.map((child) => (
              <TreeNode key={child.path} node={child} depth={depth + 1} selectedPath={selectedPath} onSelect={onSelect} />
            ))}
          </ul>
        )}
      </li>
    )
  }
  return (
    <li>
      <button
        type='button'
        onClick={() => onSelect(node.path)}
        style={{ paddingLeft: pad }}
        className={cn(
          'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left font-mono text-[12px] hover:bg-background',
          selectedPath === node.path ? 'bg-background text-foreground' : 'text-foreground/70',
        )}
      >
        <FileTextIcon className='size-3.5 shrink-0 text-muted-foreground' />
        <span className='truncate'>{node.name}</span>
      </button>
    </li>
  )
}
