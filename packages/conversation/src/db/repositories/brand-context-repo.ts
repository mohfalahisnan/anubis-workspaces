import type { BrandContext } from '@anubis/shared'
import { readSection, writeSections } from '../../documents/markdown-sections.js'
import type { MarkdownDocumentStore } from '../../documents/document-store.js'

const ROOT = 'knowledge/brand'
const DOC_ID_PREFIX = 'brand-context'

const SECTIONS = {
  brandGuideline: 'Brand Guideline',
  toneOfVoice: 'Tone of Voice',
  targetAudience: 'Target Audience',
  nichePositioning: 'Niche Positioning',
  contentRules: 'Content Rules',
} as const

export type BrandContextFields = Pick<
  BrandContext,
  'brandGuideline' | 'toneOfVoice' | 'targetAudience' | 'nichePositioning' | 'contentRules'
>

export class BrandContextRepo {
  constructor(private readonly documents: MarkdownDocumentStore) {}

  private docId(projectId: string): string {
    return `${DOC_ID_PREFIX}-${projectId}`
  }

  get(projectId: string): BrandContext {
    const doc = this.documents.find('brand', ROOT, this.docId(projectId))
    const body = doc?.body ?? ''
    return {
      projectId,
      brandGuideline: readSection(body, SECTIONS.brandGuideline) ?? '',
      toneOfVoice: readSection(body, SECTIONS.toneOfVoice) ?? '',
      targetAudience: readSection(body, SECTIONS.targetAudience) ?? '',
      nichePositioning: readSection(body, SECTIONS.nichePositioning) ?? '',
      contentRules: readSection(body, SECTIONS.contentRules) ?? '',
      updatedAt: doc ? Date.parse(String(doc.data.updated_at)) : 0,
    }
  }

  save(projectId: string, fields: BrandContextFields): BrandContext {
    const existing = this.documents.find('brand', ROOT, this.docId(projectId))
    const body = writeSections(existing?.body ?? '', {
      [SECTIONS.brandGuideline]: fields.brandGuideline,
      [SECTIONS.toneOfVoice]: fields.toneOfVoice,
      [SECTIONS.targetAudience]: fields.targetAudience,
      [SECTIONS.nichePositioning]: fields.nichePositioning,
      [SECTIONS.contentRules]: fields.contentRules,
    })
    this.documents.write({
      type: 'brand',
      projectId,
      root: ROOT,
      id: this.docId(projectId),
      title: `Brand Context — ${projectId}`,
      existing,
      data: {},
      body,
    })
    return this.get(projectId)
  }
}
