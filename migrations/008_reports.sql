CREATE TABLE reports (
	id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
	reporter_id bigint REFERENCES users(id) ON DELETE SET NULL,
	target_type text NOT NULL CHECK (target_type IN ('video', 'comment', 'user')),
	target_id bigint NOT NULL,
	owner_id bigint REFERENCES users(id) ON DELETE CASCADE,
	category text NOT NULL CHECK (category IN ('spam', 'harassment', 'hate', 'nudity', 'violence', 'self_harm', 'misinformation', 'impersonation', 'copyright', 'other')),
	description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
	status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
	resolved_by bigint REFERENCES users(id) ON DELETE SET NULL,
	resolved_at timestamptz,
	resolution text NOT NULL DEFAULT '',
	created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reports_queue ON reports(status, id DESC);
CREATE INDEX reports_target ON reports(target_type, target_id);
CREATE INDEX reports_owner ON reports(owner_id, id DESC);
CREATE UNIQUE INDEX reports_one_open_per_reporter ON reports(reporter_id, target_type, target_id) WHERE status = 'open';
