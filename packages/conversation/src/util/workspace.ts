import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const DEFAULT_ANUBISIGNORE = `# Auto-created by Anubis.
# The engine does NOT honour .gitignore — only this file.
# Add patterns to skip files/folders during indexing.

# Root AI/system folders
.agents/
.codex/
.claude/

# Runtime/generated files
runtime/
outputs/
datasets/exports/
datasets/snapshots/

# Inbox should not be indexed directly
inbox/

# Temp/cache/logs
tmp/
temp/
.cache/
*.tmp
*.log

# Secrets
.env
.env.*
*.pem
*.key
*.crt

# Heavy binaries unless explicitly ingested
*.mp4
*.mov
*.avi
*.zip
*.7z
*.rar
*.json

# Version control
.git/

# Dependencies
node_modules/
vendor/
.pnpm-store/

# Build outputs
dist/
build/
target/
out/
.next/
.turbo/

# Lockfiles (large, low information)
*.lock
pnpm-lock.yaml
package-lock.json
yarn.lock

# Anubis-generated sidecars (text already covered via the source file)
*.anubis.txt

# IDE / OS
.vscode/
.idea/
.DS_Store
Thumbs.db
`

const WORKSPACE_DIRECTORIES = [
  '.agents',
  '.codex',
  '.claude',
  'knowledge',
  'knowledge/brand',
  'knowledge/product',
  'knowledge/audience',
  'knowledge/competitors',
  'knowledge/content',
  'knowledge/research',
  'knowledge/campaigns',
  'knowledge/content-history',
  'knowledge/workflows',
  'knowledge/decisions',
  'knowledge/references',
  'tasks',
  'tasks/backlog',
  'tasks/todo',
  'tasks/in-progress',
  'tasks/in-review',
  'tasks/done',
  'inbox',
  'inbox/raw',
  'inbox/pending',
  'inbox/processed',
  'outputs',
  'outputs/drafts',
  'outputs/reports',
  'outputs/exports',
  'outputs/generated-assets',
  'outputs/reviews',
  'runtime',
  'runtime/temp',
  'runtime/cache',
  'runtime/logs',
  'runtime/indexes',
  'datasets',
  'datasets/imports',
  'datasets/exports',
  'datasets/snapshots'
]

export function ensureWorkspaceStructure(workspacePath: string): void {
  // 1. Ensure the workspace root itself exists
  if (!existsSync(workspacePath)) {
    mkdirSync(workspacePath, { recursive: true })
  }

  // 2. Ensure all subdirectories exist
  for (const dir of WORKSPACE_DIRECTORIES) {
    const fullPath = join(workspacePath, dir)
    if (!existsSync(fullPath)) {
      mkdirSync(fullPath, { recursive: true })
    }
  }

  // 3. Ensure default files exist
  const files: Record<string, string> = {
    '.anubisignore': DEFAULT_ANUBISIGNORE,
    'CLAUDE.md': '# CLAUDE.md\n\nThis file contains workspace-level instructions for AI agents.\n',
    'AGENTS.md': '# Agents\n\nRead [CLAUDE.md](CLAUDE.md).\n',
    '_workspace.md': '# Workspace\n\nWorkspace metadata and notes.\n'
  }

  for (const [filename, content] of Object.entries(files)) {
    const filePath = join(workspacePath, filename)
    if (!existsSync(filePath)) {
      writeFileSync(filePath, content, 'utf8')
    }
  }
}
