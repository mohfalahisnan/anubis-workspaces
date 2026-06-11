-- Research Phase competitor fields.
-- platform: the source network (crawler is Instagram-only today).
ALTER TABLE competitors ADD COLUMN platform TEXT NOT NULL DEFAULT 'instagram';
-- status: 'active' | 'paused' | 'archived' (enforced in the service/Zod layer).
ALTER TABLE competitors ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
-- favorite: prioritised during research (0/1).
ALTER TABLE competitors ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
-- baselineLikes: median of the most recent posts; the score denominator.
ALTER TABLE competitors ADD COLUMN baseline_likes INTEGER;
ALTER TABLE competitors ADD COLUMN baseline_sample_size INTEGER;
ALTER TABLE competitors ADD COLUMN baseline_updated_at INTEGER;
