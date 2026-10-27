CREATE TABLE video_view_days (
	video_id bigint NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
	day date NOT NULL,
	views integer NOT NULL DEFAULT 0,
	PRIMARY KEY (video_id, day)
);
CREATE TABLE audience_days (
	author_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	day date NOT NULL,
	viewer text NOT NULL,
	PRIMARY KEY (author_id, day, viewer)
);
CREATE TABLE profile_views (
	user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	viewer text NOT NULL,
	viewed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX profile_views_user ON profile_views(user_id, viewed_at);
CREATE INDEX profile_views_viewer ON profile_views(user_id, viewer, viewed_at);
CREATE TABLE video_shares (
	video_id bigint NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
	sharer text NOT NULL,
	channel text NOT NULL CHECK (channel IN ('copy', 'message', 'platform')),
	created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX video_shares_video ON video_shares(video_id, created_at);
CREATE INDEX video_shares_sharer ON video_shares(video_id, sharer, channel, created_at);
INSERT INTO video_view_days(video_id, day, views) SELECT video_id, (viewed_at AT TIME ZONE 'UTC')::date, count(*) FROM video_views GROUP BY 1, 2;
