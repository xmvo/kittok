ALTER TABLE users ADD COLUMN suspended_at timestamptz;
CREATE TABLE admin_actions (
	id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
	admin_id bigint REFERENCES users(id) ON DELETE SET NULL,
	action text NOT NULL,
	target text NOT NULL,
	detail text NOT NULL DEFAULT '',
	created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_actions_recent ON admin_actions(created_at DESC);
