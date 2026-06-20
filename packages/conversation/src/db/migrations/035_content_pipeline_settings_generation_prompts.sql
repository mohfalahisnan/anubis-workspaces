-- Per-project Content Studio generation-prompt template overrides (image / video),
-- stored as a JSON blob alongside steps + generation profiles.
ALTER TABLE content_pipeline_settings
  ADD COLUMN generation_prompts TEXT NOT NULL DEFAULT '{}';
