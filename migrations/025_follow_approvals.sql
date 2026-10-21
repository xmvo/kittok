ALTER TABLE follows ADD COLUMN approved_at timestamptz;
CREATE INDEX follows_approved ON follows(follower_id, approved_at) WHERE approved_at IS NOT NULL;
