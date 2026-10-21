ALTER TABLE users ADD COLUMN deactivated_at timestamptz;
ALTER TABLE users ADD COLUMN delete_after timestamptz;
CREATE INDEX users_delete_after ON users(delete_after) WHERE delete_after IS NOT NULL;
ALTER TABLE user_events DROP CONSTRAINT user_events_kind_check;
ALTER TABLE user_events ADD CONSTRAINT user_events_kind_check CHECK (kind IN ('signup', 'login', 'login_failed', 'username_change', 'profile_change', 'password_reset', 'deactivated', 'reactivated'));
