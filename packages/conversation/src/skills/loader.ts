import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import matter from 'gray-matter'
import type { SkillDefinition, SkillSource } from './types.js'

export interface SkillRoots {
  autoInject: string
  optIn: string
  user: string
}

const SOURCE_PRECEDENCE: Record<SkillSource, number> = {
  user: 3,
  'builtin-opt-in': 2,
  'builtin-auto': 1,
}

export class SkillLoader {
  private cache: SkillDefinition[] | null = null

  constructor(private roots: SkillRoots) {}

  discoverAll(): SkillDefinition[] {
    if (this.cache) return this.cache
    const collected: SkillDefinition[] = []
    this.walk(this.roots.autoInject, 'builtin-auto', collected)
    this.walk(this.roots.optIn, 'builtin-opt-in', collected)
    this.walk(this.roots.user, 'user', collected)
    this.cache = this.dedupe(collected)
    return this.cache
  }

  byName(name: string): SkillDefinition | undefined {
    return this.discoverAll().find(s => s.name === name)
  }

  reload(): void {
    this.cache = null
  }

  private walk(root: string, source: SkillSource, out: SkillDefinition[]): void {
    if (!existsSync(root)) return
    const entries = readdirSync(root, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const dir = join(root, e.name)
      const file = join(dir, 'SKILL.md')
      if (!existsSync(file) || !statSync(file).isFile()) continue
      const raw = readFileSync(file, 'utf8')
      const parsed = matter(raw)
      const data = parsed.data as Record<string, unknown>
      const name = typeof data.name === 'string' && data.name.length > 0 ? data.name : e.name
      const description = typeof data.description === 'string' ? data.description : ''
      const whenToUse = typeof data.when_to_use === 'string' ? data.when_to_use : undefined
      out.push({ name, description, whenToUse, source, path: file, body: parsed.content })
    }
  }

  private dedupe(skills: SkillDefinition[]): SkillDefinition[] {
    const byName = new Map<string, SkillDefinition>()
    const seenSources = new Map<string, Set<SkillSource>>()
    for (const s of skills) {
      const seen = seenSources.get(s.name) ?? new Set<SkillSource>()
      if (seen.has(s.source)) {
        throw new Error(`Duplicate skill name within the same source: ${s.name} in ${s.source}`)
      }
      seen.add(s.source)
      seenSources.set(s.name, seen)
      const cur = byName.get(s.name)
      if (!cur || SOURCE_PRECEDENCE[s.source] > SOURCE_PRECEDENCE[cur.source]) {
        byName.set(s.name, s)
      }
    }
    return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name))
  }
}
