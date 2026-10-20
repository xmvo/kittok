ALTER TABLE users DROP CONSTRAINT users_dm_friends_check, DROP CONSTRAINT users_dm_potential_check, DROP CONSTRAINT users_dm_others_check;
ALTER TABLE users ADD CONSTRAINT users_dm_friends_check CHECK (dm_friends IN (1, 2, 3)), ADD CONSTRAINT users_dm_potential_check CHECK (dm_potential IN (1, 2, 3)),
	ADD CONSTRAINT users_dm_others_check CHECK (dm_others IN (1, 2, 3));
ALTER TABLE conversation_members ADD COLUMN request boolean NOT NULL DEFAULT false;
