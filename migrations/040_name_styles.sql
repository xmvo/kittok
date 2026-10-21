ALTER TABLE users ADD COLUMN name_style jsonb;
ALTER TABLE users ADD COLUMN nameplate text NOT NULL DEFAULT '';
