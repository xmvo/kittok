CREATE TABLE settings (
	key text PRIMARY KEY,
	value jsonb NOT NULL,
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_events (
	id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
	user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	kind text NOT NULL CHECK (kind IN ('signup', 'login', 'login_failed', 'username_change', 'profile_change')),
	ip inet,
	country text,
	language text,
	user_agent text,
	detail text NOT NULL DEFAULT '',
	created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_events_user ON user_events(user_id, id DESC);
CREATE INDEX user_events_ip ON user_events(ip) WHERE ip IS NOT NULL;
CREATE INDEX user_events_age ON user_events(created_at) WHERE ip IS NOT NULL;

ALTER TABLE sessions ADD COLUMN ip inet;
ALTER TABLE sessions ADD COLUMN country text;
ALTER TABLE sessions ADD COLUMN user_agent text;
ALTER TABLE sessions ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE violations (
	id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
	user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	admin_id bigint REFERENCES users(id) ON DELETE SET NULL,
	category text NOT NULL CHECK (category IN ('spam', 'harassment', 'hate', 'nudity', 'violence', 'self_harm', 'misinformation', 'impersonation', 'copyright', 'other')),
	reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 1000),
	video_id bigint REFERENCES videos(id) ON DELETE SET NULL,
	comment_id bigint REFERENCES comments(id) ON DELETE SET NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	revoked_at timestamptz
);
CREATE INDEX violations_user ON violations(user_id, id DESC);
