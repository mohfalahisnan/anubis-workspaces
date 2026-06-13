import { z } from 'zod'
import { parseDocumentData, type MarkdownDocument, type MarkdownDocumentStore } from '../documents/document-store.js'
import { readSection, writeSections } from '../documents/markdown-sections.js'

export type ResearchDocumentStatus = 'draft' | 'final' | 'archived'

export interface ResearchDocument {
  id: string
  projectId: string
  title: string
  status: ResearchDocumentStatus
  tags: string[]
  candidateIds: string[]
  competitorIds: string[]
  postIds: string[]
  sourceUrls: string[]
  summary?: string
  findings?: string
  evidence?: string
  createdAt: number
  updatedAt: number
}

export interface CreateResearchDocumentInput {
  id: string
  projectId?: string
  title: string
  status?: ResearchDocumentStatus
  tags?: string[]
  candidateIds?: string[]
  competitorIds?: string[]
  postIds?: string[]
  sourceUrls?: string[]
  summary?: string
  findings?: string
  evidence?: string
  now: number
}

export type UpdateResearchDocumentPatch = Partial<Omit<ResearchDocument, 'id' | 'projectId' | 'createdAt'>>

const ROOT = 'knowledge/research'
const ResearchData = z.object({
  id: z.string(),
  project_id: z.string(),
  title: z.string().min(1),
  status: z.enum(['draft', 'final', 'archived']).default('draft'),
  tags: z.array(z.string()).default([]),
  candidate_ids: z.array(z.string()).default([]),
  competitor_ids: z.array(z.string()).default([]),
  post_ids: z.array(z.string()).default([]),
  source_urls: z.array(z.string()).default([]),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
}).passthrough()

export class ResearchDocumentsRepo {
  constructor(private readonly documents: MarkdownDocumentStore) {}

  create(input: CreateResearchDocumentInput): ResearchDocument {
    const document: ResearchDocument = {
      id: input.id,
      projectId: input.projectId ?? 'default',
      title: input.title,
      status: input.status ?? 'draft',
      tags: unique(input.tags),
      candidateIds: unique(input.candidateIds),
      competitorIds: unique(input.competitorIds),
      postIds: unique(input.postIds),
      sourceUrls: unique(input.sourceUrls),
      summary: input.summary,
      findings: input.findings,
      evidence: input.evidence,
      createdAt: input.now,
      updatedAt: input.now,
    }
    this.write(document, null, input.now)
    return this.findById(input.id)!
  }

  findById(id: string): ResearchDocument | null {
    const document = this.documents.find('research', ROOT, id)
    return document ? toResearchDocument(document) : null
  }

  list(projectId?: string): ResearchDocument[] {
    return this.documents.list('research', ROOT, projectId)
      .map(toResearchDocument)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  update(id: string, patch: UpdateResearchDocumentPatch): ResearchDocument | null {
    const existing = this.documents.find('research', ROOT, id)
    if (!existing) return null
    const current = toResearchDocument(existing)
    const next: ResearchDocument = {
      ...current,
      ...patch,
      tags: patch.tags ? unique(patch.tags) : current.tags,
      candidateIds: patch.candidateIds ? unique(patch.candidateIds) : current.candidateIds,
      competitorIds: patch.competitorIds ? unique(patch.competitorIds) : current.competitorIds,
      postIds: patch.postIds ? unique(patch.postIds) : current.postIds,
      sourceUrls: patch.sourceUrls ? unique(patch.sourceUrls) : current.sourceUrls,
      updatedAt: Date.now(),
    }
    this.write(next, existing, next.updatedAt)
    return this.findById(id)
  }

  delete(id: string): ResearchDocument | null {
    const current = this.findById(id)
    if (!current) return null
    this.documents.delete('research', ROOT, id)
    return current
  }

  private write(document: ResearchDocument, existing: MarkdownDocument | null, now: number): void {
    const body = writeSections(existing?.body ?? '', {
      Summary: document.summary,
      Findings: document.findings,
      Evidence: document.evidence,
    })
    this.documents.write({
      type: 'research',
      projectId: document.projectId,
      root: ROOT,
      id: document.id,
      title: document.title,
      existing,
      now,
      data: {
        title: document.title,
        status: document.status,
        tags: document.tags,
        candidate_ids: document.candidateIds,
        competitor_ids: document.competitorIds,
        post_ids: document.postIds,
        source_urls: document.sourceUrls,
      },
      body,
    })
  }
}

function toResearchDocument(document: MarkdownDocument): ResearchDocument {
  const data = parseDocumentData(document, ResearchData, 'research')
  return {
    id: data.id,
    projectId: data.project_id,
    title: data.title,
    status: data.status,
    tags: data.tags,
    candidateIds: data.candidate_ids,
    competitorIds: data.competitor_ids,
    postIds: data.post_ids,
    sourceUrls: data.source_urls,
    summary: readSection(document.body, 'Summary'),
    findings: readSection(document.body, 'Findings'),
    evidence: readSection(document.body, 'Evidence'),
    createdAt: Date.parse(data.created_at),
    updatedAt: Date.parse(data.updated_at),
  }
}

function unique(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)))
}
