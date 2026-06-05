import type { Severity } from '../types.js'
import type { OutputValidator, ValidateInput, ValidationResult } from './types.js'

const SEVERITY_ORDER: Severity[] = ['low', 'medium', 'high', 'critical']

export class ValidationService {
  constructor(private validators: OutputValidator[]) {}

  async validate(input: ValidateInput): Promise<ValidationResult> {
    const results = await Promise.all(this.validators.map((v) => v.validate(input)))
    const issues = results.flatMap((r) => r.issues)
    const severities = results
      .map((r) => r.severity)
      .filter((s): s is Severity => Boolean(s))
      .sort((a, b) => SEVERITY_ORDER.indexOf(b) - SEVERITY_ORDER.indexOf(a))
    return {
      passed: issues.length === 0,
      severity: severities[0],
      issues,
    }
  }
}
