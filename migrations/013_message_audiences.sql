ALTER TABLE users
	ADD COLUMN dm_friends smallint NOT NULL DEFAULT 1 CHECK (dm_friends IN (1, 3)),
	ADD COLUMN dm_potential smallint NOT NULL DEFAULT 1 CHECK (dm_potential IN (1, 3)),
	ADD COLUMN dm_others smallint NOT NULL DEFAULT 1 CHECK (dm_others IN (1, 3));
UPDATE users SET dm_friends = CASE WHEN dm_policy = 'nobody' THEN 3 ELSE 1 END,
	dm_potential = CASE WHEN dm_policy = 'nobody' THEN 3 ELSE 1 END,
	dm_others = CASE WHEN dm_policy = 'everyone' THEN 1 ELSE 3 END;
ALTER TABLE users DROP COLUMN dm_policy;
