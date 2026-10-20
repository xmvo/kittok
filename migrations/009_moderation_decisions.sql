CREATE TABLE moderation_decisions (
	id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
	owner_id bigint REFERENCES users(id) ON DELETE CASCADE,
	moderator_id bigint REFERENCES users(id) ON DELETE SET NULL,
	target_type text NOT NULL CHECK (target_type IN ('video', 'comment', 'user')),
	target_id bigint NOT NULL,
	category text NOT NULL,
	reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 1000),
	content_action text NOT NULL CHECK (content_action IN ('none', 'remove', 'fyf_ineligible')),
	account_action text NOT NULL CHECK (account_action IN ('none', 'warning', 'strike', 'restrict_posting', 'restrict_comments', 'ban')),
	penalty_expires_at timestamptz,
	snapshot jsonb NOT NULL DEFAULT '{}',
	created_at timestamptz NOT NULL DEFAULT now(),
	reversed_at timestamptz,
	reversed_by bigint REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX moderation_owner ON moderation_decisions(owner_id, created_at DESC);
CREATE INDEX moderation_target ON moderation_decisions(target_type, target_id) WHERE reversed_at IS NULL;
ALTER TABLE reports ADD COLUMN decision_id bigint REFERENCES moderation_decisions(id) ON DELETE SET NULL;
CREATE TABLE moderation_appeals (
	id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
	decision_id bigint NOT NULL UNIQUE REFERENCES moderation_decisions(id) ON DELETE CASCADE,
	user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 1000),
	status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'restored', 'upheld')),
	resolution text NOT NULL DEFAULT '',
	reviewer_id bigint REFERENCES users(id) ON DELETE SET NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	reviewed_at timestamptz
);
CREATE INDEX moderation_appeals_queue ON moderation_appeals(status, id DESC);
ALTER TABLE users ADD COLUMN moderation_seen_at timestamptz NOT NULL DEFAULT now();
