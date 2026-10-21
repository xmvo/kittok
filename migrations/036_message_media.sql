CREATE TABLE message_media (
	id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
	uri text NOT NULL UNIQUE CHECK (uri ~ '^dm-[0-9a-f-]{36}$'),
	owner_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	message_id bigint REFERENCES messages(id) ON DELETE CASCADE,
	kind text NOT NULL CHECK (kind IN ('image', 'video')),
	file_name text NOT NULL,
	cover_name text,
	width integer NOT NULL CHECK (width > 0),
	height integer NOT NULL CHECK (height > 0),
	duration double precision,
	bytes bigint NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX message_media_message ON message_media(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX message_media_owner ON message_media(owner_id);
CREATE INDEX message_media_unattached ON message_media(created_at) WHERE message_id IS NULL;
