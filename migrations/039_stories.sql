ALTER TABLE videos ADD COLUMN story_expires_at timestamptz;
CREATE INDEX videos_stories ON videos(author_id, id) WHERE story_expires_at IS NOT NULL;
CREATE TABLE story_views (
	story_id bigint NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
	viewer_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	viewed_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (story_id, viewer_id)
);
CREATE INDEX story_views_viewer ON story_views(viewer_id);
