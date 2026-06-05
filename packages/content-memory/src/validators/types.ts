import type { Platform, Severity } from '../types.js'
import type { ContentContextPack } from '../context-pack/types.js'

export type ValidationIssueType =
  | 'workspace_leakage' | 'brand_violation' | 'platform_violation'
  | 'repeated_mistake' | 'missing_context' | 'unsupported_claim'
  | 'format_error' | 'sensitive_data'

export interface ValidationIssue {
  type: ValidationIssueType
  message: string
  relatedMemoryId?: string
  suggestedCorrection?: string
}

export interface ValidationResult {
  passed: boolean
  severity?: Severity
  issues: ValidationIssue[]
}

export interface ValidateInput {
  workspaceId: string
  platform: Platform
  contextPack: ContentContextPack
  output: string
}

export interface OutputValidator {
  name: string
  validate(input: ValidateInput): Promise<ValidationResult>
}
