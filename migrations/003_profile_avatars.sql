ALTER TABLE users ADD COLUMN avatar_name text CHECK (avatar_name ~ '^avatar-[0-9]+-[0-9a-f-]{36}\.jpg$');
