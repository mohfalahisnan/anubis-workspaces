-- Bio: the Instagram profile bio, auto-filled on capture, manually editable.
ALTER TABLE competitors ADD COLUMN bio TEXT;
-- Level: manual override of the followers-derived competitor level.
-- One of 'black' | 'green' | 'yellow' | 'red'; NULL means derive from followers.
ALTER TABLE competitors ADD COLUMN level TEXT;
