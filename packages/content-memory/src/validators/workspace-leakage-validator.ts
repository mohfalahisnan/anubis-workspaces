import type { BrandWorkspacesRepo } from '../db/repositories/brand-workspaces-repo.js'
import type { OutputValidator, ValidateInput, ValidationIssue, ValidationResult } from './types.js'

export class WorkspaceLeakageValidator implements OutputValidator {
  name = 'WorkspaceLeakageValidator'
  constructor(private brands: BrandWorkspacesRepo) {}

  async validate(input: ValidateInput): Promise<ValidationResult> {
    const out = input.output.toLowerCase()
    const issues: ValidationIssue[] = []
    for (const b of this.brands.list()) {
      if (b.id === input.workspaceId) continue
      const name = b.name.trim().toLowerCase()
      if (name.length >= 3 && out.includes(name)) {
        issues.push({
          type: 'workspace_leakage',
          message: `Output references another brand workspace "${b.name}".`,
        })
      }
    }
    return { passed: issues.length === 0, severity: issues.length ? 'critical' : undefined, issues }
  }
}
