ALTER TABLE users ADD COLUMN notices_read_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX comment_likes_user ON comment_likes(user_id);
CREATE INDEX comments_author ON comments(author_id);
