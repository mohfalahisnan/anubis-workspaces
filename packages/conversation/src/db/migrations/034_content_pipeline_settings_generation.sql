-- Per-project Content Studio generation-profile overrides (image / video),
-- stored as a JSON blob alongside the per-step settings.
ALTER TABLE content_pipeline_settings
  ADD COLUMN generation_profiles TEXT NOT NULL DEFAULT '{}';
