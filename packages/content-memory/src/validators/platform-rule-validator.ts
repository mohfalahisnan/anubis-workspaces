import { forbiddenPhraseViolations } from './helpers.js'
import type { OutputValidator, ValidateInput, ValidationIssue, ValidationResult } from './types.js'

export class PlatformRuleValidator implements OutputValidator {
  name = 'PlatformRuleValidator'

  async validate(input: ValidateInput): Promise<ValidationResult> {
    const issues: ValidationIssue[] = forbiddenPhraseViolations(
      input.contextPack.platformContext.formatRules,
      input.output,
    ).map((h) => ({
      type: 'platform_violation',
      message: `Output appears to violate a platform rule: avoid "${h}".`,
    }))
    return { passed: issues.length === 0, severity: issues.length ? 'medium' : undefined, issues }
  }
}
