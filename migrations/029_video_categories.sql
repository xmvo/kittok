ALTER TABLE videos ADD COLUMN category smallint NOT NULL DEFAULT -1;
CREATE INDEX videos_category ON videos(category, id DESC);
