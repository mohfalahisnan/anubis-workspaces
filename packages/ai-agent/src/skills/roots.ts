import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export interface BuiltinSkillRoots {
  autoInject: string
  optIn: string
}

export function getBuiltinSkillRoots(): BuiltinSkillRoots {
  const here = dirname(fileURLToPath(import.meta.url))
  const pkgRoot = join(here, '..', '..')
  return {
    autoInject: join(pkgRoot, 'skills', 'auto-inject'),
    optIn: join(pkgRoot, 'skills', 'opt-in'),
  }
}
