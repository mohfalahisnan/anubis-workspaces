import { forbiddenPhraseViolations } from './helpers.js'
import type { OutputValidator, ValidateInput, ValidationIssue, ValidationResult } from './types.js'

export class BrandRuleValidator implements OutputValidator {
  name = 'BrandRuleValidator'

  async validate(input: ValidateInput): Promise<ValidationResult> {
    const rules = [
      ...input.contextPack.brandContext.constraints,
      ...input.contextPack.workspaceRules.mustAvoid,
    ]
    const issues: ValidationIssue[] = forbiddenPhraseViolations(rules, input.output).map((h) => ({
      type: 'brand_violation',
      message: `Output appears to violate a brand rule: avoid "${h}".`,
      suggestedCorrection: `Remove or rephrase content about "${h}".`,
    }))
    return { passed: issues.length === 0, severity: issues.length ? 'high' : undefined, issues }
  }
}
