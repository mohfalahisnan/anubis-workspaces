import type { CompetitorSummary, ResearchCandidateSummary } from '@anubis/shared'
import type { DateFilterState } from './research'

/* Builds the JSON payload for the Research page's "Export JSON" action: the
   currently-visible candidates serialized as detailed posts, each enriched with
   its competitor's context. Pure — the page handles the actual file download. */

export interface ResearchExportCompetitor {
  handle: string
  displayName?: string
  niche?: string
  followers?: number
  avgLikes?: number
  baselineLikes?: number
  level?: CompetitorSummary['level']
}

/** A detailed post: the full candidate plus resolved competitor context. */
export interface ResearchExportPost extends ResearchCandidateSummary {
  competitor?: ResearchExportCompetitor
}

export interface ResearchExportFilters {
  date: DateFilterState
  validation: string
  level: string
}

export interface ResearchExportProject {
  id?: string
  name?: string
}

export interface ResearchExportFile {
  kind: 'anubis-research-export'
  schemaVersion: 1
  exportedAt: number
  project?: ResearchExportProject
  filters: ResearchExportFilters
  count: number
  posts: ResearchExportPost[]
}

export interface BuildResearchExportArgs {
  /** Already filtered/sorted candidates — exported verbatim. */
  candidates: ResearchCandidateSummary[]
  competitorById: Map<string, CompetitorSummary>
  project?: ResearchExportProject
  filters: ResearchExportFilters
  exportedAt: number
}

function toExportCompetitor(c: CompetitorSummary): ResearchExportCompetitor {
  return {
    handle: c.handle,
    displayName: c.displayName,
    niche: c.niche,
    followers: c.followers,
    avgLikes: c.avgLikes,
    baselineLikes: c.baselineLikes,
    level: c.level,
  }
}

export function buildResearchExport({
  candidates,
  competitorById,
  project,
  filters,
  exportedAt,
}: BuildResearchExportArgs): ResearchExportFile {
  const posts: ResearchExportPost[] = candidates.map((c) => {
    const competitor = competitorById.get(c.competitorId)
    return { ...c, competitor: competitor ? toExportCompetitor(competitor) : undefined }
  })
  return {
    kind: 'anubis-research-export',
    schemaVersion: 1,
    exportedAt,
    project,
    filters,
    count: posts.length,
    posts,
  }
}
