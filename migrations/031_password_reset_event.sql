ALTER TABLE user_events DROP CONSTRAINT user_events_kind_check;
ALTER TABLE user_events ADD CONSTRAINT user_events_kind_check CHECK (kind IN ('signup', 'login', 'login_failed', 'username_change', 'profile_change', 'password_reset'));
