ALTER TABLE videos ADD COLUMN view_count bigint NOT NULL DEFAULT 0 CHECK (view_count >= 0);
CREATE TABLE video_views (
	video_id bigint NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
	viewer text NOT NULL,
	viewed_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (video_id, viewer)
);
CREATE INDEX video_views_age ON video_views(viewed_at);
