ALTER TABLE moderation_decisions ADD COLUMN feature text CHECK (feature IN ('video', 'comment', 'message', 'profile', 'live'));
ALTER TABLE moderation_decisions ADD COLUMN severe boolean NOT NULL DEFAULT false;
UPDATE moderation_decisions SET feature = CASE target_type WHEN 'video' THEN 'video' WHEN 'comment' THEN 'comment' ELSE 'profile' END;
ALTER TABLE moderation_decisions ALTER COLUMN feature SET NOT NULL;

CREATE TABLE moderation_restrictions (
	id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
	decision_id bigint REFERENCES moderation_decisions(id) ON DELETE CASCADE,
	user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	moderator_id bigint REFERENCES users(id) ON DELETE SET NULL,
	feature text NOT NULL CHECK (feature IN ('upload', 'comment', 'message', 'live', 'follow', 'profile')),
	reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 1000),
	created_at timestamptz NOT NULL DEFAULT now(),
	expires_at timestamptz,
	lifted_at timestamptz,
	lifted_by bigint REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX moderation_restrictions_active ON moderation_restrictions(user_id, feature) WHERE lifted_at IS NULL;

INSERT INTO moderation_restrictions(decision_id, user_id, moderator_id, feature, reason, created_at, expires_at, lifted_at, lifted_by)
	SELECT id, owner_id, moderator_id, CASE account_action WHEN 'restrict_posting' THEN 'upload' ELSE 'comment' END, reason, created_at, penalty_expires_at, reversed_at, reversed_by
	FROM moderation_decisions WHERE account_action IN ('restrict_posting', 'restrict_comments') AND owner_id IS NOT NULL;
UPDATE moderation_decisions SET account_action = 'strike', penalty_expires_at = created_at + interval '90 days' WHERE account_action IN ('restrict_posting', 'restrict_comments');
UPDATE moderation_decisions SET penalty_expires_at = NULL WHERE account_action = 'ban';
ALTER TABLE moderation_decisions DROP CONSTRAINT moderation_decisions_account_action_check;
ALTER TABLE moderation_decisions ADD CONSTRAINT moderation_decisions_account_action_check CHECK (account_action IN ('none', 'warning', 'strike', 'ban'));

INSERT INTO moderation_decisions(owner_id, moderator_id, target_type, target_id, category, reason, content_action, account_action, penalty_expires_at, created_at, reversed_at, feature)
	SELECT user_id, admin_id, CASE WHEN video_id IS NOT NULL THEN 'video' WHEN comment_id IS NOT NULL THEN 'comment' ELSE 'user' END, coalesce(video_id, comment_id, user_id),
		category, reason, 'none', 'strike', created_at + interval '90 days', created_at, revoked_at, CASE WHEN video_id IS NOT NULL THEN 'video' WHEN comment_id IS NOT NULL THEN 'comment' ELSE 'profile' END
	FROM violations;
DROP TABLE violations;
INSERT INTO moderation_decisions(owner_id, target_type, target_id, category, reason, content_action, account_action, created_at, feature)
	SELECT id, 'user', id, 'other', 'Suspended by an administrator', 'none', 'ban', suspended_at, 'profile' FROM users WHERE suspended_at IS NOT NULL;
ALTER TABLE moderation_appeals ADD COLUMN contact_email text CHECK (char_length(contact_email) <= 254);
