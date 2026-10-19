ALTER TABLE comments ADD COLUMN parent_id bigint REFERENCES comments(id) ON DELETE CASCADE;
ALTER TABLE comments ADD CONSTRAINT comments_parent_not_self CHECK (parent_id <> id);
CREATE INDEX comments_replies ON comments(parent_id, id);
CREATE TABLE comment_likes (
	user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	comment_id bigint NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
	created_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY(user_id, comment_id)
);
CREATE INDEX comment_likes_comment ON comment_likes(comment_id);
