ALTER TABLE conversations ADD COLUMN name text NOT NULL DEFAULT '' CHECK (char_length(name) <= 50);
ALTER TABLE conversations ADD COLUMN owner_id bigint REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE conversations ADD COLUMN info_version bigint NOT NULL DEFAULT 1;
