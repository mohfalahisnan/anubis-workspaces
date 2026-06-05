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
