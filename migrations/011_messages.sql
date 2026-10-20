CREATE TABLE conversations (
	id bigint GENERATED ALWAYS AS IDENTITY (START WITH 4000000000000000001) PRIMARY KEY,
	conversation_key text NOT NULL UNIQUE,
	conversation_type integer NOT NULL CHECK (conversation_type IN (1, 2)),
	creator_id bigint REFERENCES users(id) ON DELETE SET NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conversation_members (
	conversation_id bigint NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
	user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	read_index bigint NOT NULL DEFAULT 0,
	min_index bigint NOT NULL DEFAULT 0,
	muted boolean NOT NULL DEFAULT false,
	joined_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX conversation_members_user ON conversation_members(user_id);

CREATE TABLE messages (
	id bigint GENERATED ALWAYS AS IDENTITY (START WITH 5000000000000000001) PRIMARY KEY,
	conversation_id bigint NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
	sender_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	client_message_id text NOT NULL CHECK (char_length(client_message_id) BETWEEN 1 AND 64),
	message_type integer NOT NULL,
	content text NOT NULL CHECK (char_length(content) <= 20000),
	ext jsonb NOT NULL DEFAULT '{}',
	index_in_conversation bigint NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (conversation_id, index_in_conversation),
	UNIQUE (sender_id, client_message_id)
);
CREATE INDEX messages_conversation ON messages(conversation_id, index_in_conversation DESC);
