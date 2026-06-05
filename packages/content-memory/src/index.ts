export type {
  Scope,
  Platform,
  DocumentStatus,
  SourceType,
  BrandWorkspaceStatus,
} from './types.js'
export { PLATFORMS, DEFAULT_WORKSPACE_ID } from './types.js'

export type { Db, Migration } from './db/types.js'
export { CONTENT_MEMORY_MIGRATIONS } from './db/migrations/index.js'

export type { BrandWorkspace } from './db/repositories/brand-workspaces-repo.js'
export { BrandWorkspacesRepo } from './db/repositories/brand-workspaces-repo.js'

export type {
  KnowledgeDocument,
  NewKnowledgeDocument,
  SearchKnowledgeInput,
  ScoredDocument,
} from './db/repositories/knowledge-documents-repo.js'
export { KnowledgeDocumentsRepo } from './db/repositories/knowledge-documents-repo.js'

export type { CreateBrandWorkspaceInput } from './workspaces/brand-workspaces-service.js'
export { BrandWorkspacesService } from './workspaces/brand-workspaces-service.js'

export type { ContentType, ApprovalStatus } from './types.js'
export { CONTENT_TYPES, APPROVAL_STATUSES } from './types.js'

export type { Embedder } from './embedding/embedder.js'
export type { XenovaEmbedderOptions } from './embedding/xenova-embedder.js'
export { XenovaEmbedder } from './embedding/xenova-embedder.js'
export { bundledModelCacheDir } from './embedding/model-path.js'
export { toBlob, fromBlob, cosine } from './embedding/vector.js'

export type {
  ContentSimilarityItem,
  SearchSimilarInput,
  ScoredSimilarityItem,
} from './db/repositories/content-similarity-items-repo.js'
export { ContentSimilarityItemsRepo } from './db/repositories/content-similarity-items-repo.js'

export type { IngestSimilarityInput } from './similarity/similarity-ingestion-service.js'
export {
  SimilarityIngestionService,
  normalizeSimilarityText,
} from './similarity/similarity-ingestion-service.js'
