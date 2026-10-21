CREATE TABLE reposts (
	user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	video_id bigint NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
	created_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY(user_id, video_id)
);
CREATE INDEX reposts_video ON reposts(video_id);
