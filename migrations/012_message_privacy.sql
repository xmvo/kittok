ALTER TABLE users ADD COLUMN dm_policy text NOT NULL DEFAULT 'everyone' CHECK (dm_policy IN ('everyone', 'following', 'nobody'));
