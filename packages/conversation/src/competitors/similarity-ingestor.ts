import type { Platform, SimilarityIngestionService } from '@anubis/content-memory'
import type { Db } from '../db/client.js'

interface JoinRow {
  id: string
  caption: string | null
  likes: number | null
  comments: number | null
}

const INSTAGRAM: Platform = 'instagram'

/**
 * Ingests captured posts into the workspace-scoped similarity store. Scope is
 * derived from competitors.workspace_id (added in Phase 1); captured_posts are
 * Instagram-only today.
 */
export class CapturedPostsSimilarityIngestor {
  constructor(
    private db: Db,
    private ingestion: SimilarityIngestionService,
  ) {}

  async ingestForWorkspace(workspaceId: string): Promise<{ ingested: number }> {
    const rows = this.db
      .prepare(`
        SELECT cp.id AS id, cp.caption AS caption, cp.likes AS likes, cp.comments AS comments
        FROM captured_posts cp
        JOIN competitors c ON c.id = cp.competitor_id
        WHERE c.deleted_at IS NULL AND c.workspace_id = ?
      `)
      .all(workspaceId) as JoinRow[]

    for (const r of rows) {
      const engagement =
        r.likes == null && r.comments == null ? null : (r.likes ?? 0) + (r.comments ?? 0)
      await this.ingestion.ingest({
        workspaceId,
        platform: INSTAGRAM,
        contentId: r.id,
        contentType: 'competitor_post',
        caption: r.caption,
        engagementScore: engagement,
      })
    }

    return { ingested: rows.length }
  }
}
