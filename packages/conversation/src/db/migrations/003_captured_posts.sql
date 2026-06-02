CREATE TABLE captured_posts (
  id              TEXT PRIMARY KEY,
  competitor_id   TEXT NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  username        TEXT NOT NULL,                  -- snapshot of the IG handle on the post
  post_url        TEXT NOT NULL,
  caption         TEXT,
  likes           INTEGER,
  comments        INTEGER,
  posted_at       TEXT,                           -- ISO timestamp from IG (kept verbatim)
  media_kind      TEXT,                           -- 'image' | 'video' | 'carousel'
  media_url       TEXT,                           -- first URL — handy for thumbnails
  carousel_count  INTEGER,                        -- number of items if media_kind = 'carousel'
  captured_at     INTEGER NOT NULL,
  raw             TEXT                            -- full PostData JSON, for future re-processing
);
CREATE UNIQUE INDEX uq_captured_posts_url
  ON captured_posts(competitor_id, post_url);
CREATE INDEX idx_captured_posts_competitor_time
  ON captured_posts(competitor_id, posted_at DESC);
CREATE INDEX idx_captured_posts_likes
  ON captured_posts(likes DESC);
