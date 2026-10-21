ALTER TABLE videos ADD COLUMN pinned_at timestamptz;
CREATE INDEX videos_pinned ON videos(author_id, pinned_at DESC) WHERE pinned_at IS NOT NULL;
