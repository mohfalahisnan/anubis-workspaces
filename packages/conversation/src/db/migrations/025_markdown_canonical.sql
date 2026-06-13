DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS content_items;

-- Pre-production reset: old competitor records have no canonical Markdown
-- representation, so clear the dependent operational graph in FK order.
DELETE FROM research_candidates;
DELETE FROM research_sessions;
DELETE FROM captured_posts;
DELETE FROM competitors;

CREATE TABLE content_item_runtime (
  content_id          TEXT PRIMARY KEY,
  analytics_likes     INTEGER,
  analytics_comments  INTEGER,
  analytics_saves     INTEGER,
  metrics_synced_at   INTEGER
);
