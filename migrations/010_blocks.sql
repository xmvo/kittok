CREATE TABLE blocks (
	blocker_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	blocked_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	created_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (blocker_id, blocked_id),
	CHECK (blocker_id <> blocked_id)
);
CREATE INDEX blocks_blocked ON blocks(blocked_id);
