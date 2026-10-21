ALTER TABLE messages ADD COLUMN properties jsonb NOT NULL DEFAULT '{}';
ALTER TABLE messages ADD COLUMN property_version bigint NOT NULL DEFAULT 0;
