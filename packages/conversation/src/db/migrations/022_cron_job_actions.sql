ALTER TABLE cron_jobs ADD COLUMN action_type TEXT NOT NULL DEFAULT 'message';
ALTER TABLE cron_jobs ADD COLUMN action_config TEXT;
