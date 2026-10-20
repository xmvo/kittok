ALTER TABLE reports DROP CONSTRAINT reports_target_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_check CHECK (target_type IN ('video', 'comment', 'user', 'message'));
ALTER TABLE moderation_decisions DROP CONSTRAINT moderation_decisions_target_type_check;
ALTER TABLE moderation_decisions ADD CONSTRAINT moderation_decisions_target_type_check CHECK (target_type IN ('video', 'comment', 'user', 'message'));
