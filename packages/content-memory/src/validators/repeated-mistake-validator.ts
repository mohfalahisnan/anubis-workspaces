import type { ExperienceIndexService } from '../experience/experience-index-service.js'
import type { OutputValidator, ValidateInput, ValidationIssue, ValidationResult } from './types.js'

export class RepeatedMistakeValidator implements OutputValidator {
  name = 'RepeatedMistakeValidator'
  constructor(private experience: ExperienceIndexService) {}

  async validate(input: ValidateInput): Promise<ValidationResult> {
    const out = input.output.toLowerCase()
    const memories = this.experience.recallActive({
      workspaceId: input.workspaceId, platform: input.platform, limit: 50,
    })
    const issues: ValidationIssue[] = []
    for (const m of memories) {
      if (m.type !== 'mistake' && m.type !== 'anti_pattern') continue
      const trigger = (m.triggerPattern ?? '').trim().toLowerCase()
      if (trigger.length >= 3 && out.includes(trigger)) {
        issues.push({
          type: 'repeated_mistake',
          message: `Output repeats a known mistake: ${m.title}.`,
          relatedMemoryId: m.id,
          suggestedCorrection: m.correction,
        })
      }
    }
    return { passed: issues.length === 0, severity: issues.length ? 'high' : undefined, issues }
  }
}
