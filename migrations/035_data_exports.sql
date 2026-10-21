CREATE TABLE data_exports (
	id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
	user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	format text NOT NULL CHECK (format IN ('txt', 'json')),
	sections text[] NOT NULL CHECK (cardinality(sections) > 0),
	created_at timestamptz NOT NULL DEFAULT now(),
	expires_at timestamptz NOT NULL
);
CREATE INDEX data_exports_user ON data_exports(user_id, id DESC);
CREATE INDEX data_exports_expiry ON data_exports(expires_at);
ALTER TABLE user_events DROP CONSTRAINT user_events_kind_check;
ALTER TABLE user_events ADD CONSTRAINT user_events_kind_check CHECK (kind IN ('signup', 'login', 'login_failed', 'username_change', 'profile_change', 'password_reset', 'deactivated', 'reactivated', 'data_requested', 'data_downloaded'));
