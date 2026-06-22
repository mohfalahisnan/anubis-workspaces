/* Ports the static configuration from anubis-lite engine_constants.py.
   Graph / lessons / plugin-update constants are intentionally omitted (v1 scope). */

export const INDEX_VERSION = 2

// BM25 + phrase/proximity ranking (query-time; changing these never needs an INDEX_VERSION bump)
export const BM25_K1 = 1.5
export const BM25_B = 0.75
export const HEADING_BOOST = 0.3
export const PROX_GAIN = 0.35
export const SEARCH_POOL_MULTIPLIER = 4
export const SEARCH_POOL_MIN = 25
export const CONF_COVERAGE_MIN = 0.5
export const CONF_SCORE_FLOOR = 1.0

// Benchmark (parity test only)
export const BENCHMARK_PROBE_TERMS = 3
export const BENCHMARK_DEPTH = 10

export interface EngineConfig {
  chunkTargetTokens: number
  chunkMaxTokens: number
  searchResultLimit: number
  searchExcerptLinesBefore: number
  searchExcerptLinesAfter: number
}

export const DEFAULT_CONFIG: EngineConfig = {
  chunkTargetTokens: 700,
  chunkMaxTokens: 900,
  searchResultLimit: 8,
  searchExcerptLinesBefore: 2,
  searchExcerptLinesAfter: 2,
}

export const STOP_WORDS: ReadonlySet<string> = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'also', 'am',
  'an', 'and', 'any', 'are', 'as', 'at', 'be', 'because', 'been', 'before',
  'being', 'below', 'between', 'both', 'but', 'by', 'can', 'could', 'did',
  'do', 'does', 'doing', 'down', 'during', 'each', 'few', 'for', 'from',
  'further', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers',
  'him', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'just',
  'me', 'more', 'most', 'my', 'no', 'nor', 'not', 'now', 'of', 'off', 'on',
  'once', 'only', 'or', 'other', 'our', 'out', 'over', 'own', 'same', 'she',
  'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'them',
  'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too',
  'under', 'until', 'up', 'very', 'was', 'we', 'were', 'what', 'when',
  'where', 'which', 'while', 'who', 'whom', 'why', 'will', 'with', 'you',
  'your',
])

export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  title TEXT,
  content_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  heading TEXT,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  token_estimate INTEGER,
  content_hash TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id),
  UNIQUE(document_id, chunk_index)
);

CREATE TABLE terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chunk_id INTEGER NOT NULL,
  term TEXT NOT NULL,
  frequency INTEGER NOT NULL,
  FOREIGN KEY (chunk_id) REFERENCES chunks(id),
  UNIQUE(chunk_id, term)
);

CREATE INDEX idx_terms_term ON terms(term);
CREATE INDEX idx_documents_path ON documents(path);
CREATE INDEX idx_chunks_document_id ON chunks(document_id);
`
