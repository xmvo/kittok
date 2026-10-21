ALTER TABLE users ADD COLUMN private_account boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN comment_permission text NOT NULL DEFAULT 'everyone' CHECK (comment_permission IN ('everyone', 'followers', 'friends', 'none'));
ALTER TABLE videos ADD COLUMN visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'followers', 'friends', 'only_me'));
ALTER TABLE videos ADD COLUMN comment_permission text NOT NULL DEFAULT 'default' CHECK (comment_permission IN ('default', 'everyone', 'followers', 'friends', 'none'));

CREATE TABLE follow_requests (
	follower_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	following_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	created_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY(follower_id, following_id),
	CHECK (follower_id <> following_id)
);
CREATE INDEX follow_requests_recipient ON follow_requests(following_id, created_at DESC);
