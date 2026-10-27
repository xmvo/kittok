CREATE TABLE studio_uploads (
	id text PRIMARY KEY,
	owner_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	kind text NOT NULL CHECK (kind IN ('video', 'image')),
	file_name text NOT NULL,
	cover_name text,
	width integer NOT NULL,
	height integer NOT NULL,
	duration double precision,
	bytes bigint NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX studio_uploads_age ON studio_uploads(created_at);
